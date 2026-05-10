import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";

export function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const token = searchParams.get("token");
    const error = searchParams.get("message");

    if (error) {
      setStatus("error");
      setErrorMessage(decodeURIComponent(error));
      return;
    }

    if (token) {
      // Store the JWT token
      api.setToken(token);
      localStorage.setItem("dt_token", token);
      setStatus("success");

      // Redirect to dashboard after brief delay
      setTimeout(() => navigate("/"), 1500);
    } else {
      setStatus("error");
      setErrorMessage("No authentication token received");
    }
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center space-y-4 max-w-md">
        {status === "loading" && (
          <>
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto" />
            <p className="text-muted-foreground">Connecting your account...</p>
          </>
        )}
        {status === "success" && (
          <>
            <div className="text-4xl">&#10003;</div>
            <p className="text-lg font-semibold">Connected Successfully!</p>
            <p className="text-muted-foreground">Redirecting to dashboard...</p>
          </>
        )}
        {status === "error" && (
          <>
            <div className="text-4xl">&#10007;</div>
            <p className="text-lg font-semibold text-destructive">Authentication Failed</p>
            <p className="text-muted-foreground">{errorMessage}</p>
            <button
              onClick={() => navigate("/")}
              className="text-primary underline text-sm mt-4"
            >
              Back to Dashboard
            </button>
          </>
        )}
      </div>
    </div>
  );
}
