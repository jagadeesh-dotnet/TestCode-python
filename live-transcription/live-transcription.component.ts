import { Component, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';

interface RecordingSession {
    sessionId: string;
    recordingId: number;
    startTime: Date;
    isRecording: boolean;
}

interface SpeakerSegment {
    start: number;
    end: number;
    speaker: string;
}

interface LiveStatus {
    transcript: string;
    partial: string;
    segments: SpeakerSegment[];
}

@Component({
    selector: 'app-live-transcription',
    standalone: true,
    imports: [CommonModule, HttpClientModule, FormsModule],
    templateUrl: './live-transcription.component.html',
    styleUrl: './live-transcription.component.css'
})
export class LiveTranscriptionComponent implements OnDestroy {
    stationName = 'Live Mic Recording';

    // Recording state
    session: RecordingSession | null = null;
    mediaRecorder: MediaRecorder | null = null;
    recordingTimer = 0;
    timerInterval: any = null;
    statusPollInterval: any = null;

    // Live Data
    fullTranscript = '';
    partialTranscript = '';
    speakerSegments: SpeakerSegment[] = [];

    // UI state
    statusMsg = '';
    errorMsg = '';
    isRequesting = false;

    constructor(private http: HttpClient, private cdr: ChangeDetectorRef) { }

    async startRecording() {
        try {
            this.errorMsg = '';
            this.statusMsg = 'Starting recording...';
            this.isRequesting = true;
            this.cdr.detectChanges();

            // 1. Start backend session
            const response = await this.http.post<any>('http://localhost:8000/recorder/mic/start', {
                station_name: this.stationName
            }).toPromise();

            this.session = {
                sessionId: response.session_id,
                recordingId: response.recording_id,
                startTime: new Date(),
                isRecording: true
            };

            // 2. Get Mic Stream
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });

            // 3. Start MediaRecorder with 1s timeslice
            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm' // Browser will usually pick opus in webm
            });

            this.mediaRecorder.ondataavailable = async (event) => {
                if (event.data.size > 0 && this.session) {
                    await this.uploadChunk(event.data);
                }
            };

            this.mediaRecorder.start(1000); // 1 second chunks

            // 4. Start Timers
            this.recordingTimer = 0;
            this.timerInterval = setInterval(() => {
                this.recordingTimer++;
                this.cdr.detectChanges();
            }, 1000);

            // 5. Start Polling for Live Status
            this.statusPollInterval = setInterval(() => {
                this.pollLiveStatus();
            }, 1000);

            this.statusMsg = 'Recording & Transcribing...';
            this.isRequesting = false;
            this.cdr.detectChanges();

        } catch (err: any) {
            this.errorMsg = 'Failed to start: ' + err.message;
            console.error(err);
            this.isRequesting = false;
            this.session = null;
            this.cdr.detectChanges();
        }
    }

    async uploadChunk(chunk: Blob) {
        if (!this.session) return;
        try {
            const formData = new FormData();
            formData.append('file', chunk, 'chunk.webm');
            await this.http.post(
                `http://localhost:8000/recorder/mic/upload-chunk/${this.session.sessionId}`,
                formData
            ).toPromise();
        } catch (err) {
            console.error('Error uploading chunk:', err);
        }
    }

    async pollLiveStatus() {
        if (!this.session) return;
        try {
            const status = await this.http.get<LiveStatus>(
                `http://localhost:8000/recorder/mic/live-status/${this.session.sessionId}`
            ).toPromise();

            if (status) {
                this.fullTranscript = status.transcript;
                this.partialTranscript = status.partial;
                this.speakerSegments = status.segments || [];
                this.cdr.detectChanges();
            }
        } catch (err) {
            console.error('Error polling status:', err);
        }
    }

    async stopRecording() {
        if (!this.session || !this.mediaRecorder) return;

        try {
            this.statusMsg = 'Stopping...';
            this.mediaRecorder.stop();
            this.mediaRecorder.stream.getTracks().forEach(t => t.stop());

            clearInterval(this.timerInterval);
            clearInterval(this.statusPollInterval);

            // Wait for pending uploads? 
            await new Promise(resolve => setTimeout(resolve, 500));

            await this.http.post(
                `http://localhost:8000/recorder/mic/stop/${this.session.sessionId}`,
                {}
            ).toPromise();

            this.statusMsg = 'Recording saved.';
            this.session = null;
            this.mediaRecorder = null;

            // One last poll?
            // Optionally we could fetch final result here.

            setTimeout(() => {
                this.statusMsg = '';
                this.cdr.detectChanges();
            }, 3000);

        } catch (err: any) {
            this.errorMsg = 'Error stopping: ' + err.message;
        }
    }

    formatTime(seconds: number): string {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    formatSegmentTime(seconds: number): string {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    ngOnDestroy() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        if (this.statusPollInterval) clearInterval(this.statusPollInterval);
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
            this.mediaRecorder.stream.getTracks().forEach(t => t.stop());
        }
    }
}
