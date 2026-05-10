import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, CheckCircle, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";

interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  connectedServices: Array<{
    provider: string;
    connected: boolean;
    expiresAt: string;
  }>;
}

export function Settings() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const response = await api.getMe();
        setProfile(response.data as UserProfile);
      } catch {
        // Not authenticated
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);

  const microsoftConnected = profile?.connectedServices.some(
    (s) => s.provider === "microsoft" && s.connected
  );
  const zoomConnected = profile?.connectedServices.some(
    (s) => s.provider === "zoom" && s.connected
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Settings</h1>
              <p className="text-sm text-muted-foreground">
                Manage connected services and preferences
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-2xl space-y-6">
        {/* Profile */}
        {profile && (
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <p>
                  <span className="text-muted-foreground">Name:</span>{" "}
                  <span className="font-medium">{profile.displayName}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Email:</span>{" "}
                  <span className="font-medium">{profile.email}</span>
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Microsoft Connection */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  Microsoft 365
                  {microsoftConnected && (
                    <Badge variant="success" className="flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" />
                      Connected
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  Access your Outlook calendar and email to discover meetings and send summaries.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Permissions: Calendar (read), Email (read + send), Profile (read)
              </p>
              {microsoftConnected ? (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => (window.location.href = api.getAuthUrl("microsoft"))}>
                    Reconnect
                  </Button>
                </div>
              ) : (
                <Button onClick={() => (window.location.href = api.getAuthUrl("microsoft"))}>
                  Connect Microsoft Account
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Zoom Connection */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  Zoom
                  {zoomConnected && (
                    <Badge variant="success" className="flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" />
                      Connected
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  Allow the Digital Twin bot to join your Zoom meetings as a participant.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Requires a Zoom developer account. Set up at{" "}
                <a
                  href="https://marketplace.zoom.us"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary inline-flex items-center gap-1"
                >
                  marketplace.zoom.us
                  <ExternalLink className="h-3 w-3" />
                </a>
              </p>
              {zoomConnected ? (
                <Button variant="outline" size="sm" onClick={() => (window.location.href = api.getAuthUrl("zoom"))}>
                  Reconnect
                </Button>
              ) : (
                <Button onClick={() => (window.location.href = api.getAuthUrl("zoom"))}>
                  Connect Zoom Account
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* API Keys Info */}
        <Card>
          <CardHeader>
            <CardTitle>API Services</CardTitle>
            <CardDescription>
              These services are configured via environment variables on the server.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span>Deepgram (Transcription)</span>
                <Badge variant="outline">Server-side</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Claude API (Summarization)</span>
                <Badge variant="outline">Server-side</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Redis (Job Queue)</span>
                <Badge variant="outline">Server-side</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
