import { showErrorToast, showInfoToast } from './toasts';

function copyWithExecCommand(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    return document.execCommand('copy');
  } catch (e) {
    console.error('share: execCommand copy failed', { error: e });
    return false;
  } finally {
    document.body.removeChild(ta);
  }
}

/**
 * Uses the Web Share API when available, otherwise copies the URL to the clipboard.
 */
export async function shareOrCopyUrl(opts: { title: string; text: string; url: string }): Promise<void> {
  const { title, text, url } = opts;

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (err) {
      const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
      if (name === 'AbortError') return;
      console.warn('share: native share failed, using clipboard', { url, error: err });
    }
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
    } else if (!copyWithExecCommand(url)) {
      throw new Error('Clipboard unavailable');
    }
    showInfoToast('Link copied to clipboard');
  } catch (err) {
    if (copyWithExecCommand(url)) {
      showInfoToast('Link copied to clipboard');
      return;
    }
    console.error('share: could not share or copy', { url, error: err });
    showErrorToast('Could not share or copy. Use the GBIF button and copy from the address bar.');
  }
}
