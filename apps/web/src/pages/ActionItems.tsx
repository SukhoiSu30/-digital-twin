import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, CheckCircle, Circle, Filter } from "lucide-react";
import { api } from "@/lib/api";

interface ActionItem {
  id: string;
  title: string;
  description: string | null;
  assignee: string | null;
  priority: string;
  status: string;
  dueDate: string | null;
  meeting: {
    id: string;
    title: string;
    startTime: string;
  };
}

const priorityOrder = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const priorityColors: Record<string, string> = {
  URGENT: "bg-red-100 text-red-800",
  HIGH: "bg-orange-100 text-orange-800",
  MEDIUM: "bg-yellow-100 text-yellow-800",
  LOW: "bg-green-100 text-green-800",
};

export function ActionItems() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pending" | "done">("pending");

  const fetchItems = async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {};
      if (filter !== "all") params.status = filter;
      const response = await api.getActions(params);
      setItems(response.data as ActionItem[]);
    } catch (err) {
      console.error("Failed to fetch action items:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [filter]);

  const handleToggle = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === "done" ? "pending" : "done";
    try {
      await api.updateAction(id, { status: newStatus });
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, status: newStatus } : item))
      );
    } catch (err) {
      console.error("Failed to update:", err);
    }
  };

  const sortedItems = [...items].sort(
    (a, b) =>
      (priorityOrder[a.priority as keyof typeof priorityOrder] ?? 99) -
      (priorityOrder[b.priority as keyof typeof priorityOrder] ?? 99)
  );

  const pendingCount = items.filter((i) => i.status === "pending").length;
  const doneCount = items.filter((i) => i.status === "done").length;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Action Items</h1>
              <p className="text-sm text-muted-foreground">
                {pendingCount} pending, {doneCount} completed
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-3xl">
        {/* Filters */}
        <div className="flex items-center gap-2 mb-6">
          <Filter className="h-4 w-4 text-muted-foreground" />
          {(["all", "pending", "done"] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Button>
          ))}
        </div>

        {loading ? (
          <p className="text-muted-foreground text-center py-8">Loading...</p>
        ) : sortedItems.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <CheckCircle className="h-12 w-12 mx-auto mb-3 opacity-40" />
            <p>No action items found.</p>
            <p className="text-sm mt-1">
              Action items are automatically created after meetings.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {sortedItems.map((item) => (
              <Card
                key={item.id}
                className={item.status === "done" ? "opacity-60" : ""}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => handleToggle(item.id, item.status)}
                      className="mt-0.5 shrink-0"
                    >
                      {item.status === "done" ? (
                        <CheckCircle className="h-5 w-5 text-green-600 fill-green-100" />
                      ) : (
                        <Circle className="h-5 w-5 text-gray-300" />
                      )}
                    </button>
                    <div className="flex-1">
                      <p
                        className={`font-medium ${
                          item.status === "done" ? "line-through text-muted-foreground" : ""
                        }`}
                      >
                        {item.title}
                      </p>
                      {item.description && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {item.description}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            priorityColors[item.priority] || ""
                          }`}
                        >
                          {item.priority}
                        </span>
                        {item.assignee && (
                          <Badge variant="outline" className="text-xs">
                            {item.assignee}
                          </Badge>
                        )}
                        {item.dueDate && (
                          <span className="text-xs text-muted-foreground">
                            Due: {new Date(item.dueDate).toLocaleDateString()}
                          </span>
                        )}
                        <button
                          onClick={() => navigate(`/meetings/${item.meeting.id}`)}
                          className="text-xs text-primary hover:underline"
                        >
                          From: {item.meeting.title}
                        </button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
