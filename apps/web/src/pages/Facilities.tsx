import { Plus, Users, Calendar } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { mockFacilities } from "@/data/mockData";
import { motion } from "framer-motion";

export default function Facilities() {
  return (
    <motion.div
      className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-4xl"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <PageHeader title="Facilities" description="View and reserve church spaces.">
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1.5" /> Reserve Space
        </Button>
      </PageHeader>

      <div className="grid sm:grid-cols-2 gap-4">
        {mockFacilities.map((space) => (
          <Card key={space.id} className="shadow-sm border-border/60 hover:shadow-md transition-shadow">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-base font-semibold text-foreground">{space.name}</h3>
                  <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    <span>Capacity: {space.capacity}</span>
                  </div>
                </div>
                <Badge
                  className={`text-[10px] font-medium border-0 shrink-0 ${
                    space.reservations.length === 0
                      ? "bg-success/10 text-success"
                      : "bg-accent text-accent-foreground"
                  }`}
                >
                  {space.reservations.length === 0 ? "Available" : `${space.reservations.length} booked`}
                </Badge>
              </div>

              {space.reservations.length > 0 ? (
                <div className="space-y-2">
                  {space.reservations.map((res, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-secondary/50">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{res.title}</p>
                        <p className="text-[10px] text-muted-foreground">{res.time} · {res.bookedBy}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">No upcoming reservations</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </motion.div>
  );
}
