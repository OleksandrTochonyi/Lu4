import { Directive, ElementRef, HostListener, inject, input } from '@angular/core';

/** Shows the full text as a native tooltip on hover — but only when the element's
 *  text is actually cut off (ellipsis). Pass the text, or leave empty to use the
 *  element's own text content. */
@Directive({ selector: '[rdOverflowTip]', standalone: true })
export class OverflowTipDirective {
  private el = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly rdOverflowTip = input<string | null | undefined>('');

  @HostListener('mouseenter')
  onEnter(): void {
    const node = this.el.nativeElement;
    if (node.scrollWidth > node.clientWidth) {
      node.title = (this.rdOverflowTip() || node.textContent || '').trim();
    } else {
      node.removeAttribute('title');
    }
  }
}
