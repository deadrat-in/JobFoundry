import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsPage } from '../SettingsPage';
import { ThemeProvider } from '../../../context/ThemeContext';
import { ToastProvider } from '../../../context/ToastContext';
import { AuthProvider } from '../../../context/AuthContext';
import { api } from '../../../api/client';

const mockSettings = {
  apiKey: 'test-key',
  apiUrl: 'http://localhost:8080',
  threshold: 75,
};

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    vi.spyOn(api, 'getSettings').mockResolvedValue({
      settings: {
        scorer_model: 'openrouter/google/gemini-2.0-flash-exp:free',
        scorer_provider: 'openrouter',
        scorer_api_key: 'sk-or-••••••••0d60',
        scorer_api_base: '',
        scorer_threshold: 75,
        worker_enabled: true,
        worker_poll_interval_seconds: 10,
        tailor_model: 'openrouter/google/gemini-2.0-flash-exp:free',
        tailor_api_key: '',
        tailor_api_base: '',
        tailor_theme: 'jsonresume-theme-folio',
        tailor_timeout_seconds: 900,
        opik_enabled: false,
        opik_project_name: 'jobfoundry',
        opik_api_key: '',
        opik_workspace: '',
        opik_url_override: '',
        theme_color_mode: 'system',
        theme_accent: 'indigo',
      },
      meta: {
        scorer_model: {
          source: 'default',
          hasCustomKey: true,
          updatedAt: null,
          type: 'string',
          secret: false,
        },
        scorer_threshold: {
          source: 'default',
          hasCustomKey: true,
          updatedAt: null,
          type: 'number',
          secret: false,
        },
        scorer_api_key: {
          source: 'system',
          hasCustomKey: true,
          updatedAt: 12345,
          type: 'string',
          secret: true,
        },
      },
    });

    vi.spyOn(api, 'getDiagnostics').mockResolvedValue({
      status: 'healthy',
      uptime: 3600,
      timestamp: Date.now(),
      version: '0.1.0',
      database: {
        totalJobs: 42,
        unscoredJobs: 0,
        newJobs: 10,
        appliedJobs: 5,
        rejectedJobs: 2,
        totalUsers: 1,
        totalResumes: 2,
      },
      environment: {
        nodeVersion: 'v22.0.0',
        platform: 'linux',
      },
    });
  });

  const renderComponent = (onSaveSettings = vi.fn()) => {
    return render(
      <AuthProvider>
        <ThemeProvider>
          <ToastProvider>
            <SettingsPage settings={mockSettings} onSaveSettings={onSaveSettings} />
          </ToastProvider>
        </ThemeProvider>
      </AuthProvider>
    );
  };

  it('renders page header and tabs', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText('System & Dashboard Settings')).toBeInTheDocument();
    });

    expect(screen.getByText(/Appearance & UI/i)).toBeInTheDocument();
    expect(screen.getByText(/AI Fit Scorer/i)).toBeInTheDocument();
    expect(screen.getByText(/AI Resume Tailor/i)).toBeInTheDocument();
    expect(screen.getByText(/Observability/i)).toBeInTheDocument();
    expect(screen.getByText(/Extension & Auth/i)).toBeInTheDocument();
    expect(screen.getByText(/Telemetry & System/i)).toBeInTheDocument();
  });

  it('switches to AI Fit Scorer tab and tests LLM connection', async () => {
    const testLlmSpy = vi.spyOn(api, 'testLlmConnection').mockResolvedValue({
      success: true,
      latencyMs: 150,
      message: 'Connected successfully to model (150ms)',
    });

    renderComponent();
    await waitFor(() => {
      expect(screen.queryByText(/Loading system configuration/i)).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/AI Fit Scorer/i));

    await waitFor(() => {
      expect(screen.getByText('LLM Fit Scorer Configuration')).toBeInTheDocument();
    });
    expect(screen.getByText('Database Override')).toBeInTheDocument();

    const testBtn = screen.getByTestId('test-llm-btn');
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(testLlmSpy).toHaveBeenCalled();
      expect(screen.getAllByText(/Connected successfully to model/i).length).toBeGreaterThanOrEqual(
        1
      );
    });
  });

  it('updates settings and saves successfully', async () => {
    const updateSpy = vi.spyOn(api, 'updateSettings').mockResolvedValue({
      ok: true,
      settings: {
        scorer_model: 'custom/new-model',
        scorer_threshold: 85,
      } as any,
      meta: {} as any,
    });
    const onSaveSettings = vi.fn();

    renderComponent(onSaveSettings);
    await waitFor(() => {
      expect(screen.queryByText(/Loading system configuration/i)).not.toBeInTheDocument();
    });

    // Switch to Scorer tab and change model
    fireEvent.click(screen.getByText(/AI Fit Scorer/i));
    const modelInput = screen.getByPlaceholderText('openrouter/z-ai/glm-5.3-flash');
    fireEvent.change(modelInput, { target: { value: 'custom/new-model' } });

    // Save changes
    const saveBtn = screen.getAllByRole('button', { name: /Save Changes/i })[0];
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          scorer_model: 'custom/new-model',
        })
      );
      expect(onSaveSettings).toHaveBeenCalled();
    });
  });

  it('navigates to Telemetry & System tab and displays live metrics', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.queryByText(/Loading system configuration/i)).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Telemetry & System/i));

    expect(screen.getByText('System Diagnostics & Architecture')).toBeInTheDocument();
    expect(screen.getByText('Total Jobs in DB')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText(/\/data\/jobfoundry.db/i)).toBeInTheDocument();
  });
});
