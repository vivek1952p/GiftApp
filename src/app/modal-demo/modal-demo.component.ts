import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-modal-demo',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './modal-demo.component.html',
  styleUrls: ['./modal-demo.component.scss'],
})
export class ModalDemoComponent {
  isModalOpen = false;
  isInputModalOpen = false;
  message = '';
  guestName = '';
  selectedTheme = 'classic';

  openModal() {
    this.isModalOpen = true;
  }

  closeModal() {
    this.isModalOpen = false;
  }

  openInputModal() {
    this.isInputModalOpen = true;
  }

  closeInputModal() {
    this.isInputModalOpen = false;
  }

  submitGuest() {
    if (!this.guestName.trim()) {
      this.message = 'Please enter a name before confirming.';
      return;
    }

    this.message = `Thanks, ${this.guestName.trim()}! Your gift preference has been saved.`;
    this.closeInputModal();
  }
}
