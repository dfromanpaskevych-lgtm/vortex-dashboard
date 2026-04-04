import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw, CheckCircle2, XCircle, Loader2, Clock, Database } from "lucide-react";
import { toast } from "sonner";

export default function Sync() {
  const utils = trpc.useUtils();
  const { data: syncStatus } = trpc.sync.status.useQuery(undefined, {
    refetchInterval: 5000,
  });
  const { data: syncLogs, isLoading: logsLoading } = trpc.sync.logs.useQuery();

  const triggerSync = trpc.sync.trigger.useMutation({
    onSuccess: () => {
      toast.success("Синхронізацію запущено");
      utils.sync.status.invalidate();
      utils.sync.logs.invalidate();
    },
    onError: (err) => {
      toast.error("Помилка: " + err.message);
    },
  });

  const seedData = trpc.sync.seed.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
        utils.orders.list.invalidate();
        utils.dashboard.metrics.invalidate();
      } else {
        toast.error(data.message);
      }
    },
    onError: (err) => {
      toast.error("Помилка: " + err.message);
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Синхронізація</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Управління синхронізацією даних з Vortex ERP API
        </p>
      </div>

      {/* Status & Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="h-4 w-4" />
              Поточний статус
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Статус:</span>
                <Badge variant={syncStatus?.isSyncing ? "default" : "secondary"}>
                  {syncStatus?.isSyncing ? (
                    <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Синхронізація...</>
                  ) : (
                    <><CheckCircle2 className="h-3 w-3 mr-1" /> Готово</>
                  )}
                </Badge>
              </div>
              {syncStatus?.lastSync && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Остання синхронізація:</span>
                    <span className="text-sm">
                      {new Date(syncStatus.lastSync.startedAt).toLocaleString("uk-UA")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Результат:</span>
                    <Badge variant={syncStatus.lastSync.status === "completed" ? "default" : "destructive"}>
                      {syncStatus.lastSync.status === "completed" ? "Успішно" : syncStatus.lastSync.status === "failed" ? "Помилка" : "В процесі"}
                    </Badge>
                  </div>
                  {syncStatus.lastSync.ordersProcessed != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Оброблено замовлень:</span>
                      <span className="text-sm font-mono">{syncStatus.lastSync.ordersProcessed}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Дії
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              className="w-full"
              onClick={() => triggerSync.mutate({ days: 7 })}
              disabled={syncStatus?.isSyncing || triggerSync.isPending}
            >
              {triggerSync.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Синхронізувати (7 днів)
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => triggerSync.mutate({ days: 3 })}
              disabled={syncStatus?.isSyncing || triggerSync.isPending}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Швидка синхронізація (3 дні)
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => seedData.mutate()}
              disabled={seedData.isPending}
            >
              {seedData.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Database className="h-4 w-4 mr-2" />
              )}
              Завантажити початкові дані
            </Button>
            <p className="text-xs text-muted-foreground">
              Автоматична синхронізація: кожні 30 хвилин (останні 3 дні)
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Sync History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Історія синхронізацій
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Дата</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead className="text-right">Замовлень</TableHead>
                <TableHead className="text-right">Нових</TableHead>
                <TableHead className="text-right">Змінених</TableHead>
                <TableHead>Помилка</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logsLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}>
                        <div className="h-4 bg-muted animate-pulse rounded" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : !syncLogs || syncLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Синхронізацій ще не було
                  </TableCell>
                </TableRow>
              ) : (
                syncLogs.map((log: any) => (
                  <TableRow key={log.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="text-xs whitespace-nowrap">
                      {new Date(log.startedAt).toLocaleString("uk-UA")}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          log.status === "completed" ? "default" :
                          log.status === "failed" ? "destructive" : "secondary"
                        }
                        className="text-[10px]"
                      >
                        {log.status === "completed" ? (
                          <><CheckCircle2 className="h-3 w-3 mr-1" /> Успішно</>
                        ) : log.status === "failed" ? (
                          <><XCircle className="h-3 w-3 mr-1" /> Помилка</>
                        ) : (
                          <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> В процесі</>
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-right font-mono">{log.ordersProcessed || 0}</TableCell>
                    <TableCell className="text-xs text-right font-mono text-green-500">{log.newOrders || 0}</TableCell>
                    <TableCell className="text-xs text-right font-mono text-yellow-500">{log.modifiedOrders || 0}</TableCell>
                    <TableCell className="text-xs text-muted-foreground truncate max-w-[200px]" title={log.errorMessage || ""}>
                      {log.errorMessage || "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
