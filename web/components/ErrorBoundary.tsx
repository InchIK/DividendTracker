import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Optional render override for the fallback UI. */
  renderFallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }


  reset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      if (this.props.renderFallback) {
        return this.props.renderFallback(this.state.error, this.reset);
      }
      return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center">
          <div className="text-5xl mb-4">😵</div>
          <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">
            頁面發生錯誤
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 max-w-md break-words">
            {this.state.error.message || "未知的渲染錯誤"}
          </p>
          <button
            type="button"
            onClick={this.reset}
            className="mt-4 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
          >
            重試
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;