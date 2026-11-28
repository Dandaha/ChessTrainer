import { Component, type ErrorInfo, type ReactNode } from 'react';
import { buttonClass } from './ui.tsx';

/**
 * Catches a crash in one screen so the rest of the app stays usable: the sidebar keeps working and
 * the screen offers a way back, instead of the whole window going blank. `resetKey` (the address)
 * clears the error when the person goes elsewhere.
 */
export class ErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null; key: string }> {
  override state = { error: null as Error | null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { error: Error | null; key: string }) {
    return props.resetKey === state.key ? null : { error: null, key: props.resetKey };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="mx-auto max-w-lg space-y-3 p-8">
        <h2 className="text-lg font-semibold">Something went wrong on this screen</h2>
        <p className="text-sm text-muted">Your saved work is safe. Go back, or reload the app to start this screen again.</p>
        <pre className="max-h-40 overflow-auto rounded-md bg-surface-2 p-3 text-xs whitespace-pre-wrap">{error.message}</pre>
        <div className="flex gap-2">
          <button type="button" className={buttonClass} onClick={() => history.back()}>
            Go back
          </button>
          <button type="button" className={buttonClass} onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
