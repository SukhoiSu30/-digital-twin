const API_BASE = "/api";

class ApiClient {
  private token: string | null = null;

  setToken(token: string) {
    this.token = token;
  }

  clearToken() {
    this.token = null;
  }

  getToken(): string | null {
    return this.token;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<{ success: boolean; data?: T; error?: string; total?: number }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    const json = await response.json();

    if (!response.ok) {
      throw new Error(json.error || `Request failed with status ${response.status}`);
    }

    return json;
  }

  // Auth
  getAuthUrl(provider: "microsoft" | "zoom") {
    return `${API_BASE}/auth/${provider}`;
  }

  getMe() {
    return this.request("/auth/me");
  }

  // Calendar
  syncCalendar() {
    return this.request("/calendar/sync", { method: "POST" });
  }

  // Meetings
  getMeetings(params?: { status?: string; date?: string }) {
    const query = new URLSearchParams(params || {}).toString();
    return this.request(`/meetings${query ? `?${query}` : ""}`);
  }

  getMeeting(id: string) {
    return this.request(`/meetings/${id}`);
  }

  updateMeeting(id: string, data: { autoJoin?: boolean; status?: string }) {
    return this.request(`/meetings/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  // Bot
  joinMeeting(meetingId: string) {
    return this.request(`/bot/join/${meetingId}`, { method: "POST" });
  }

  leaveMeeting(meetingId: string) {
    return this.request(`/bot/leave/${meetingId}`, { method: "POST" });
  }

  getBotStatus() {
    return this.request("/bot/status");
  }

  // Actions
  getActions(params?: { status?: string; priority?: string; meetingId?: string }) {
    const query = new URLSearchParams(params || {}).toString();
    return this.request(`/actions${query ? `?${query}` : ""}`);
  }

  updateAction(id: string, data: Record<string, unknown>) {
    return this.request(`/actions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }
}

export const api = new ApiClient();
