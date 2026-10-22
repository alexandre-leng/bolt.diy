import { useState, useEffect } from 'react';
import { checkConnection } from '~/lib/api/connection';

const ACKNOWLEDGED_CONNECTION_ISSUE_KEY = 'bolt_acknowledged_connection_issue';

type ConnectionIssueType = 'disconnected' | 'high-latency' | null;

const getAcknowledgedIssue = (): string | null => {
  try {
    return localStorage.getItem(ACKNOWLEDGED_CONNECTION_ISSUE_KEY);
  } catch {
    return null;
  }
};

export const useConnectionStatus = () => {
  const [hasConnectionIssues, setHasConnectionIssues] = useState(false);
  const [currentIssue, setCurrentIssue] = useState<ConnectionIssueType>(null);
  const [acknowledgedIssue, setAcknowledgedIssue] = useState<string | null>(() => getAcknowledgedIssue());

  const checkStatus = async () => {
    try {
      const status = await checkConnection();
      const issue = !status.connected ? 'disconnected' : status.latency > 1000 ? 'high-latency' : null;

      setCurrentIssue(issue);

      // Only show issues if they're new or different from the acknowledged one
      setHasConnectionIssues(issue !== null && issue !== acknowledgedIssue);
    } catch (error) {
      console.error('Failed to check connection:', error);

      // Show connection issues if we can't even check the status
      setCurrentIssue('disconnected');
      setHasConnectionIssues(true);
    }
  };

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    let stopped = false;

    const visible = () => document.visibilityState === 'visible' && document.hasFocus();

    const stop = () => {
      if (interval) {
        clearInterval(interval);
      }

      interval = undefined;
    };

    const start = () => {
      stop();

      if (stopped || !visible()) {
        return;
      }

      void checkStatus();
      interval = setInterval(() => {
        if (visible()) {
          void checkStatus();
        } else {
          stop();
        }
      }, 10_000);
    };

    const onVisibility = () => (visible() ? start() : stop());
    start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);
    window.addEventListener('blur', onVisibility);

    return () => {
      stopped = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
      window.removeEventListener('blur', onVisibility);
    };
  }, [acknowledgedIssue]);

  const acknowledgeIssue = () => {
    setAcknowledgedIssue(currentIssue);

    try {
      localStorage.setItem(ACKNOWLEDGED_CONNECTION_ISSUE_KEY, currentIssue ?? '');
    } catch {
      /* Storage may be unavailable. */
    }
    setHasConnectionIssues(false);
  };

  const resetAcknowledgment = () => {
    setAcknowledgedIssue(null);

    try {
      localStorage.removeItem(ACKNOWLEDGED_CONNECTION_ISSUE_KEY);
    } catch {
      /* Storage may be unavailable. */
    }
    checkStatus();
  };

  return { hasConnectionIssues, currentIssue, acknowledgeIssue, resetAcknowledgment };
};
