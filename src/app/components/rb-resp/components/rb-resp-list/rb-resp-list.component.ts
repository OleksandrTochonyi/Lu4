import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RbData } from 'src/app/services/rb-data';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-rb-resp-list',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './rb-resp-list.component.html',
  styleUrls: ['./rb-resp-list.component.scss'],
})
export class RbRespListComponent implements OnInit {
      rbDataServive = inject(RbData);

      ngOnInit() {
        this.rbDataServive.getItems().subscribe(r=>console.log(r));
      }
}

