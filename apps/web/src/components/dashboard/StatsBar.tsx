import { Card, CardContent } from "@/components/ui/card";
import { Calendar, Bot, FileText, CheckCircle } from "lucide-react";

interface StatsBarProps {
  totalMeetings: number;
  activeBots: number;
  completedSummaries: number;
  pendingActions: number;
}

export function StatsBar({ totalMeetings, activeBots, completedSummaries, pendingActions }: StatsBarProps) {
  const stats = [
    { label: "Today's Meetings", value: totalMeetings, icon: Calendar, color: "text-blue-600" },
    { label: "Active Bots", value: activeBots, icon: Bot, color: "text-green-600" },
    { label: "Summaries Ready", value: completedSummaries, icon: FileText, color: "text-purple-600" },
    { label: "Pending Actions", value: pendingActions, icon: CheckCircle, color: "text-orange-600" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {stats.map((stat) => (
        <Card key={stat.label}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <stat.icon className={`h-8 w-8 ${stat.color}`} />
              <div>
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
