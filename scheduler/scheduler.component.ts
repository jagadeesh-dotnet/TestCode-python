import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { SchedulerService, Schedule } from '../../services/scheduler.service';
import { SchedulerModalComponent } from './scheduler-modal/scheduler-modal.component';

@Component({
    selector: 'app-scheduler',
    standalone: true,
    imports: [CommonModule], // Add NgbModule if needed
    templateUrl: './scheduler.component.html',
    styleUrls: ['./scheduler.component.css']
})
export class SchedulerComponent implements OnInit {
    schedules: Schedule[] = [];

    constructor(private schedulerService: SchedulerService, private modalService: NgbModal) { }

    ngOnInit(): void {
        this.loadSchedules();
    }

    loadSchedules() {
        this.schedulerService.getSchedules().subscribe(data => {
            this.schedules = data;
        });
    }

    openAddModal() {
        const modalRef = this.modalService.open(SchedulerModalComponent);
        modalRef.result.then((result) => {
            if (result) {
                this.schedulerService.createSchedule(result).subscribe(() => {
                    this.loadSchedules();
                });
            }
        }, (reason) => {
            // dismissed
        });
    }

    openEditModal(schedule: Schedule) {
        const modalRef = this.modalService.open(SchedulerModalComponent);
        modalRef.componentInstance.schedule = schedule;
        modalRef.result.then((result) => {
            if (result) {
                this.schedulerService.updateSchedule(schedule.id!, result).subscribe(() => {
                    this.loadSchedules();
                });
            }
        }, (reason) => {
            // dismissed
        });
    }

    deleteSchedule(id: number) {
        if (confirm("Are you sure?")) {
            this.schedulerService.deleteSchedule(id).subscribe(() => {
                this.loadSchedules();
            })
        }
    }
}
