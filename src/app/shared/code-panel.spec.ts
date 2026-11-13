import { TestBed } from '@angular/core/testing';
import { Clipboard } from '@angular/cdk/clipboard';
import { CodePanel } from './code-panel';
import { expectNoAxeViolations } from '../../testing/axe';

describe('CodePanel', () => {
  let copy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    copy = vi.fn(() => true);
    TestBed.configureTestingModule({
      imports: [CodePanel],
      providers: [{ provide: Clipboard, useValue: { copy } }],
    });
  });

  async function render(code = 'type A struct {}', label = 'models.go') {
    const fixture = TestBed.createComponent(CodePanel);
    fixture.componentRef.setInput('code', code);
    fixture.componentRef.setInput('label', label);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('shows the code in a labelled, keyboard-focusable block', async () => {
    const { el } = await render();

    const pre = el.querySelector('pre')!;
    expect(pre.textContent).toBe('type A struct {}');
    expect(pre.getAttribute('aria-label')).toBe('models.go');
    expect(pre.getAttribute('tabindex')).toBe('0');
  });

  it('copies the code and announces it', async () => {
    const { fixture, el } = await render();
    const status = el.querySelector('[role="status"]')!;
    expect(status.textContent?.trim()).toBe('');

    el.querySelector('button')!.click();
    await fixture.whenStable();

    expect(copy).toHaveBeenCalledWith('type A struct {}');
    expect(status.textContent?.trim()).toBe('Copied');
  });

  it('names the copy button after the label and passes AXE', async () => {
    const { el } = await render('x', 'models.go');

    expect(el.querySelector('button')?.textContent).toContain('Copy models.go');
    await expectNoAxeViolations(el);
  });
});
