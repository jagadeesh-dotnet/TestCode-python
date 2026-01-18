import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Schedule {
    id?: number;
    name: string;
    stream_url: string;
    schedule_type: 'one_time' | 'recurring';
    start_time: string; // HH:mm:ss
    end_time: string;
    days_of_week?: string;
    specific_date?: string; // YYYY-MM-DD
    is_active: boolean;
}

@Injectable({
    providedIn: 'root'
})
export class SchedulerService {
    private apiUrl = 'http://localhost:8000/schedules';

    constructor(private http: HttpClient) { }

    getSchedules(): Observable<Schedule[]> {
        return this.http.get<Schedule[]>(this.apiUrl + '/');
    }

    createSchedule(schedule: Schedule): Observable<Schedule> {
        return this.http.post<Schedule>(this.apiUrl + '/', schedule);
    }

    updateSchedule(id: number, schedule: Schedule): Observable<Schedule> {
        return this.http.put<Schedule>(`${this.apiUrl}/${id}`, schedule);
    }

    deleteSchedule(id: number): Observable<any> {
        return this.http.delete(`${this.apiUrl}/${id}`);
    }
}
