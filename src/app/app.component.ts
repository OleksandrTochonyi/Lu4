import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RbData } from './services/rb-data';
import { RbRespComponent } from "./components/rb-resp/rb-resp.component";

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RbRespComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {
  rbDataServive = inject(RbData);
  title = 'lu4';
  ngOnInit() {
    this.rbDataServive.getItems().subscribe(r=>console.log(r));
  }
}
