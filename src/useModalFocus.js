import { useEffect, useRef } from 'react';

export default function useModalFocus() {
  const dialogRef = useRef(null);
  const previousFocus = useRef(document.activeElement);
  useEffect(() => {
    const dialog = dialogRef.current;
    const backdrop = dialog.parentElement;
    const siblings = [...backdrop.parentElement.children].filter((item) => item !== backdrop);
    const previousInert = siblings.map((item) => item.inert);
    siblings.forEach((item) => { item.inert = true; });
    const focusable = () => [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter((item) => item.getClientRects().length);
    if (!dialog.contains(document.activeElement)) (dialog.querySelector('input[name="name"]') || focusable()[0])?.focus();
    function trapFocus(event) {
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (!dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', trapFocus, true);
    return () => {
      document.removeEventListener('keydown', trapFocus, true);
      siblings.forEach((item, index) => { item.inert = previousInert[index]; });
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    };
  }, []);
  return dialogRef;
}
