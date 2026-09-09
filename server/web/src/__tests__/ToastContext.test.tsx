import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { ToastProvider, useToast } from '../context/ToastContext';

const TestToastConsumer: React.FC = () => {
  const { success, error, warning, info } = useToast();

  return (
    <div>
      <button onClick={() => success('Job Saved Successfully', 'Saved')}>Trigger Success</button>
      <button onClick={() => error('Something broke', 'Error Alert')}>Trigger Error</button>
      <button onClick={() => warning('Low fit score', 'Warning Alert')}>Trigger Warning</button>
      <button onClick={() => info('Telemetry syncing...', 'Info Alert')}>Trigger Info</button>
    </div>
  );
};

describe('ToastContext', () => {
  it('renders and displays toasts with icons and dismiss buttons', () => {
    render(
      <ToastProvider>
        <TestToastConsumer />
      </ToastProvider>
    );

    expect(screen.queryByText('Job Saved Successfully')).not.toBeInTheDocument();

    act(() => {
      screen.getByText('Trigger Success').click();
    });

    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.getByText('Job Saved Successfully')).toBeInTheDocument();

    // Dismiss
    const dismissBtn = screen.getByLabelText('Dismiss notification');
    act(() => {
      dismissBtn.click();
    });

    expect(screen.queryByText('Job Saved Successfully')).not.toBeInTheDocument();
  });

  it('renders multiple toast types correctly', () => {
    render(
      <ToastProvider>
        <TestToastConsumer />
      </ToastProvider>
    );

    act(() => {
      screen.getByText('Trigger Error').click();
      screen.getByText('Trigger Warning').click();
    });

    expect(screen.getByText('Error Alert')).toBeInTheDocument();
    expect(screen.getByText('Something broke')).toBeInTheDocument();
    expect(screen.getByText('Warning Alert')).toBeInTheDocument();
    expect(screen.getByText('Low fit score')).toBeInTheDocument();
  });
});
