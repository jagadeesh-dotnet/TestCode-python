import subprocess
import os
import datetime
import threading
from typing import Optional
import wave
import uuid
import json
from vosk import KaldiRecognizer
from app.services.transcription_service import transcription_service

class RecorderService:
    def __init__(self, output_dir: str = "recordings"):
        self.output_dir = output_dir
        if not os.path.exists(self.output_dir):
            os.makedirs(self.output_dir)
        self.processes = {}
        self.mic_sessions = {}  # Store active microphone recording sessions

    def start_mic_recording(self, station_name: str = "Microphone") -> tuple[str, str]:
        """Start a new microphone recording session"""
        session_id = str(uuid.uuid4())
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{station_name}_{timestamp}.wav"
        temp_filename = f"{station_name}_{timestamp}_temp.webm"
        filepath = os.path.join(self.output_dir, filename).replace("\\", "/")
        temp_filepath = os.path.join(self.output_dir, temp_filename).replace("\\", "/")
        
        # Create temporary WebM file to collect chunks
        temp_file = open(temp_filepath, 'wb')
        
        # Initialize Vosk recognizer for live transcription
        vosk_model = transcription_service._load_vosk()
        recognizer = None
        if vosk_model:
            # Assuming 16kHz for microphone input as set in frontend
            recognizer = KaldiRecognizer(vosk_model, 16000)
        
        self.mic_sessions[session_id] = {
            'filepath': filepath,
            'temp_filepath': temp_filepath,
            'filename': filename,
            'temp_file': temp_file,
            'start_time': datetime.datetime.now(),
            'chunks_received': 0,
            'recognizer': recognizer,
            'live_transcript': "",
            'live_segments': [],
            'active': True
        }
        
        # Start background diarization thread
        diar_thread = threading.Thread(target=self._diarization_loop, args=(session_id,), daemon=True)
        diar_thread.start()
        
        print(f"Started microphone recording session {session_id}: {filepath}")
        return session_id, filepath

    def _diarization_loop(self, session_id: str):
        """Periodically run diarization on the current file"""
        import time
        while session_id in self.mic_sessions and self.mic_sessions[session_id].get('active', False):
            time.sleep(10) # Run every 10 seconds
            try:
                if session_id not in self.mic_sessions:
                    break
                    
                session = self.mic_sessions[session_id]
                filepath = session['filepath']
                
                # We need to convert current temp WebM to WAV for diarization validation
                # But 'filepath' is the final target. We can create a snapshot of the temp file.
                snapshot_path = filepath.replace(".wav", "_snapshot.wav")
                ffmpeg_path = r"C:\Users\jagad\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.0.1-full_build\bin\ffmpeg.exe"
                temp_filepath = session['temp_filepath']
                
                # Snapshot current state
                if os.path.exists(temp_filepath) and os.path.getsize(temp_filepath) > 0:
                    subprocess.run([
                        ffmpeg_path, "-y", "-i", temp_filepath,
                        "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", snapshot_path
                    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    
                    if os.path.exists(snapshot_path):
                        # Run diarization
                        segments = transcription_service.diarize(snapshot_path)
                        session['live_segments'] = segments
                        
                        # Cleanup snapshot
                        try:
                            os.remove(snapshot_path)
                        except:
                            pass
            except Exception as e:
                print(f"Diarization loop error for {session_id}: {e}")

    def append_audio_chunk(self, session_id: str, audio_data: bytes) -> bool:
        """Append audio chunk to active recording session"""
        if session_id not in self.mic_sessions:
            print(f"Session {session_id} not found")
            return False
        
        try:
            session = self.mic_sessions[session_id]
            session['temp_file'].write(audio_data)
            session['chunks_received'] += 1
            
            # Process for live transcription
            if session['recognizer']:
                # Note: We are receiving WebM chunks, but Vosk needs PCM. 
                # Ideally, frontend should send PCM or ISOM (wav) chunks, or we need to decode here.
                # However, for "almost realtime" with WebM chunks, direct feeding might fail or be garbage 
                # if it contains headers.
                # A quick hack for MVP: Use ffmpeg to convert this small chunk to PCM 
                # OR assume frontend sends WAV/PCM.
                # The frontend code sends MediaRecorder blobs (audio/webm).
                # To do this properly without complex streaming decoding on backend:
                # We can't easily decode headerless WebM chunks.
                # PLAN CHANGE: We will rely on the fact that we can't easily stream-decode random WebM chunks 
                # without a persistent decoder context. 
                # ALTERNATIVE: Use a lighter format from frontend OR just act on file growth if we had a stream reader.
                # BUT, let's try to just feed it and see, OR (better):
                # Request frontend to send WAV/PCM? Browsers match MediaRecorder to mimeTypes.
                # Let's try to convert the LATEST chunk using a temporary file (inefficient but works for 1s chunks).
                
                # Write chunk to temp file
                chunk_tmp = f"temp_chunk_{session_id}_{session['chunks_received']}.webm"
                with open(chunk_tmp, "wb") as f:
                    f.write(audio_data)
                
                # Convert to PCM 16k mono
                pcm_tmp = f"temp_chunk_{session_id}_{session['chunks_received']}.raw"
                
                ffmpeg_path = r"C:\Users\jagad\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.0.1-full_build\bin\ffmpeg.exe"
                
                subprocess.run([
                    ffmpeg_path, "-y", "-i", chunk_tmp,
                    "-f", "s16le", "-ac", "1", "-ar", "16000", pcm_tmp
                ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                
                if os.path.exists(pcm_tmp):
                    with open(pcm_tmp, "rb") as f:
                        pcm_data = f.read()
                        if session['recognizer'].AcceptWaveform(pcm_data):
                            res = json.loads(session['recognizer'].Result())
                            text = res.get("text", "")
                            if text:
                                session['live_transcript'] += " " + text
                        else:
                            # Partial result
                            partial = json.loads(session['recognizer'].PartialResult())
                            # We don't append partials permanently, but could store for UI
                            pass
                    
                    # Cleanup
                    os.remove(pcm_tmp)
                
                if os.path.exists(chunk_tmp):
                    os.remove(chunk_tmp)

            return True
        except Exception as e:
            print(f"Error appending audio chunk: {e}")
            return False

    def get_live_status(self, session_id: str) -> dict:
        """Get live transcription status"""
        if session_id not in self.mic_sessions:
            return {}
        
        session = self.mic_sessions[session_id]
        
        # Get current partial
        current_partial = ""
        if session['recognizer']:
            partial_res = json.loads(session['recognizer'].PartialResult())
            current_partial = partial_res.get("partial", "")
        
        return {
            "transcript": session['live_transcript'].strip(),
            "partial": current_partial,
            "segments": session['live_segments']
        }

    def finalize_mic_recording(self, session_id: str) -> Optional[str]:
        """Finalize microphone recording and return file path"""
        if session_id not in self.mic_sessions:
            print(f"Session {session_id} not found")
            return None
        
        try:
            session = self.mic_sessions[session_id]
            session['active'] = False # Stop diarization loop
            session['temp_file'].close()
            
            # Flush final results from recognizer
            if session['recognizer']:
                res = json.loads(session['recognizer'].FinalResult())
                text = res.get("text", "")
                if text:
                    session['live_transcript'] += " " + text

            temp_filepath = session['temp_filepath']
            filepath = session['filepath']
            
            print(f"Converting WebM to WAV: {temp_filepath} -> {filepath}")
            
            # Convert WebM to WAV using FFmpeg
            ffmpeg_path = r"C:\Users\jagad\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.0.1-full_build\bin\ffmpeg.exe"
            
            command = [
                ffmpeg_path, "-y",
                "-i", temp_filepath,
                "-acodec", "pcm_s16le",
                "-ar", "16000",
                "-ac", "1",
                filepath
            ]
            
            result = subprocess.run(command, capture_output=True, text=True)
            
            if result.returncode != 0:
                print(f"FFmpeg conversion error: {result.stderr}")
                return None
            
            # Delete temporary WebM file
            if os.path.exists(temp_filepath):
                os.remove(temp_filepath)
            
            print(f"Finalized microphone recording: {filepath} ({session['chunks_received']} chunks)")
            del self.mic_sessions[session_id]
            
            return filepath
        except Exception as e:
            print(f"Error finalizing recording: {e}")
            return None

    def start_stream_recording(self, stream_url: str, station_name: str, schedule_id: Optional[int] = None) -> tuple[str, str]:
        """Start recording from a stream URL"""
        session_id = str(uuid.uuid4())
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{station_name}_{timestamp}.wav" 
        filepath = os.path.join(self.output_dir, filename).replace("\\", "/")
        
        # Hardcoded for now based on previous finding
        ffmpeg_path = r"C:\Users\jagad\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.0.1-full_build\bin\ffmpeg.exe"
        
        # Transcode to 16kHz mono WAV for compatibility
        command = [
            ffmpeg_path, "-y",
            "-i", stream_url,
            "-acodec", "pcm_s16le",
            "-ar", "16000",
            "-ac", "1",
            filepath
        ]
        
        print(f"Starting stream recording: {' '.join(command)}")
        try:
            process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            
            self.processes[session_id] = {
                "process": process,
                "filepath": filepath,
                "start_time": datetime.datetime.now(),
                "schedule_id": schedule_id,
                "type": "stream"
            }
            
            return session_id, filepath
        except Exception as e:
            print(f"Failed to start ffmpeg: {e}")
            raise e

    def stop_stream_recording(self, session_id: str) -> Optional[str]:
        if session_id not in self.processes:
            print(f"Session {session_id} not found in active processes")
            return None
        
        proc_info = self.processes[session_id]
        process = proc_info["process"]
        
        print(f"Stopping stream recording {session_id}")
        
        # Graceful termination
        try:
            # Sending 'q' to stdin often works for ffmpeg, or terminate
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                print("Forcing kill...")
                process.kill()
        except Exception as e:
            print(f"Error stopping process: {e}")
            
        filepath = proc_info["filepath"]
        del self.processes[session_id]
        return filepath

recorder_service = RecorderService()
