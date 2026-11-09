/** A window smaller than this share of the usable screen, in either direction, is opened up to fill it. */
const FILL_SHARE = 0.9;

/** Whether the app's window should be enlarged to the usable screen: it opened clearly smaller than the screen allows. */
export function shouldFill(window: { width: number; height: number }, screen: { width: number; height: number }): boolean {
  if (screen.width <= 0 || screen.height <= 0) return false;
  return window.width < screen.width * FILL_SHARE || window.height < screen.height * FILL_SHARE;
}
