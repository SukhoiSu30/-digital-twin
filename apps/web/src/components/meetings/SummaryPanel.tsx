import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, CheckCircle, Lightbulb, Target } from "lucide-react";

interface SummaryPanelProps {
  summary: {
    overview: string;
    keyPoints: string[];
    decisions: string[];
    emailSentAt: string | null;
  } | null;
  actionItems: Array<{
    id: string;
    title: string;
    description: string | null;
    assignee: string | null;
    priority: string;
    status: string;
    dueDate: string | null;
  }>;
  onToggleAction?: (id: string, status: string) => void;
}

const priorityColors: Record<string, string> = {
  URGENT: "bg-red-100 text-red-800",
  HIGH: "bg-orange-100 text-orange-800",
  MEDIUM: "bg-yellow-100 text-yellow-800",
  LOW: "bg-green-100 text-green-800",
};

export function SummaryPanel({ summary, actionItems, onToggleAction }: SummaryPanelProps) {
  if (!summary) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p>Summary will appear here after the meeting ends.</p>
          <p className="text-sm mt-1">Claude AI will analyze the transcript and extract key points.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Overview */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed">{summary.overview}</p>
          {summary.emailSentAt && (
            <p className="text-xs text-muted-foreground mt-3">
              Email sent {new Date(summary.emailSentAt).toLocaleString()}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Key Points */}
      {summary.keyPoints.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-yellow-600" />
              Key Points
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {summary.keyPoints.map((point, i) => (
                <li key={i} className="text-sm flex gap-2">
                  <span className="text-muted-foreground shrink-0">{i + 1}.</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Decisions */}
      {summary.decisions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Target className="h-5 w-5 text-purple-600" />
              Decisions Made
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {summary.decisions.map((decision, i) => (
                <li key={i} className="text-sm flex gap-2">
                  <CheckCircle className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                  <span>{decision}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Action Items */}
      {actionItems.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              Action Items ({actionItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {actionItems.map((item) => (
                <div
                  key={item.id}
                  className={`p-3 rounded-lg border ${
                    item.status === "done" ? "bg-muted opacity-60" : "bg-white"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <button
                        onClick={() =>
                          onToggleAction?.(
                            item.id,
                            item.status === "done" ? "pending" : "done"
                          )
                        }
                        className="mt-0.5 shrink-0"
                      >
                        <CheckCircle
                          className={`h-5 w-5 ${
                            item.status === "done"
                              ? "text-green-600 fill-green-100"
                              : "text-gray-300"
                          }`}
                        />
                      </button>
                      <div>
                        <p
                          className={`text-sm font-medium ${
                            item.status === "done" ? "line-through" : ""
                          }`}
                        >
                          {item.title}
                        </p>
                        {item.description && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {item.description}
                          </p>
                        )}
                        <div className="flex gap-2 mt-2">
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              priorityColors[item.priority] || ""
                            }`}
                          >
                            {item.priority}
                          </span>
                          {item.assignee && (
                            <span className="text-xs text-muted-foreground">
                              {item.assignee}
                            </span>
                          )}
                          {item.dueDate && (
                            <span className="text-xs text-muted-foreground">
                              Due: {new Date(item.dueDate).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
