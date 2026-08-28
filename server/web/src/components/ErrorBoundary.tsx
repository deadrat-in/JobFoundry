import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: '1.5rem',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 'var(--radius-md, 8px)',
            margin: '1rem 0',
            color: 'var(--text-primary, #fff)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: '0.75rem',
            }}
          >
            <span style={{ fontSize: '1.25rem' }}>⚠️</span>
            <h3 style={{ fontSize: '1.05rem', margin: 0, color: 'var(--color-red, #ef4444)' }}>
              {this.props.fallbackTitle || 'Component Error Occurred'}
            </h3>
          </div>
          <p
            style={{
              fontSize: '0.875rem',
              color: 'var(--text-secondary, #94a3b8)',
              marginBottom: '1rem',
            }}
          >
            {this.state.error?.message || 'An unexpected rendering error occurred in this view.'}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={this.handleReset} className="btn btn-secondary btn-sm">
              Dismiss / Retry
            </button>
            <button onClick={() => window.location.reload()} className="btn btn-primary btn-sm">
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
