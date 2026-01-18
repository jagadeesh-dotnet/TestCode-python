import { Component, Input, OnInit } from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Schedule } from '../../../services/scheduler.service';

@Component({
    selector: 'app-scheduler-modal',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, FormsModule],
    templateUrl: './scheduler-modal.component.html',
    styleUrls: ['./scheduler-modal.component.css']
})
export class SchedulerModalComponent implements OnInit {
    @Input() schedule: Schedule | undefined;
    schedulerForm!: FormGroup;

    weekDays = [
        { value: '0', label: 'Mon' },
        { value: '1', label: 'Tue' },
        { value: '2', label: 'Wed' },
        { value: '3', label: 'Thu' },
        { value: '4', label: 'Fri' },
        { value: '5', label: 'Sat' },
        { value: '6', label: 'Sun' }
    ];

    constructor(public activeModal: NgbActiveModal, private fb: FormBuilder) { }

    ngOnInit(): void {
        const defaultTime = "12:00:00";

        this.schedulerForm = this.fb.group({
            name: [this.schedule?.name || '', Validators.required],
            stream_url: [this.schedule?.stream_url || '', Validators.required],
            schedule_type: [this.schedule?.schedule_type || 'one_time', Validators.required],
            start_time: [this.schedule?.start_time || defaultTime, Validators.required],
            end_time: [this.schedule?.end_time || defaultTime, Validators.required],
            specific_date: [this.schedule?.specific_date || ''],
            days_of_week: [this.schedule?.days_of_week ? this.schedule!.days_of_week!.split(',') : []]
        });

        // Conditional Validators
        this.schedulerForm.get('schedule_type')?.valueChanges.subscribe(type => {
            if (type === 'one_time') {
                this.schedulerForm.get('specific_date')?.setValidators([Validators.required]);
                this.schedulerForm.get('days_of_week')?.clearValidators();
            } else {
                this.schedulerForm.get('specific_date')?.clearValidators();
                this.schedulerForm.get('days_of_week')?.setValidators([Validators.required]);
            }
            this.schedulerForm.get('specific_date')?.updateValueAndValidity();
            this.schedulerForm.get('days_of_week')?.updateValueAndValidity();
        });

        // Trigger validation update for initial state
        this.schedulerForm.get('schedule_type')?.updateValueAndValidity();
    }

    onDayChange(e: any) {
        const daysArray: string[] = this.schedulerForm.get('days_of_week')?.value || [];
        if (e.target.checked) {
            daysArray.push(e.target.value);
        } else {
            const index = daysArray.indexOf(e.target.value);
            if (index > -1) {
                daysArray.splice(index, 1);
            }
        }
        this.schedulerForm.get('days_of_week')?.setValue(daysArray);
    }

    isDayChecked(value: string): boolean {
        const days = this.schedulerForm.get('days_of_week')?.value;
        return days && days.includes(value);
    }

    save() {
        if (this.schedulerForm.invalid) {
            return;
        }

        const formValue = this.schedulerForm.value;

        // Format data for API
        const result: any = {
            name: formValue.name,
            stream_url: formValue.stream_url,
            schedule_type: formValue.schedule_type,
            start_time: formValue.start_time,
            end_time: formValue.end_time,
            is_active: true
        };

        if (formValue.schedule_type === 'one_time') {
            result.specific_date = formValue.specific_date;
            result.days_of_week = null;
        } else {
            result.specific_date = null;
            result.days_of_week = formValue.days_of_week.join(',');
        }

        if (this.schedule?.id) {
            result.id = this.schedule.id;
        }

        this.activeModal.close(result);
    }
}
