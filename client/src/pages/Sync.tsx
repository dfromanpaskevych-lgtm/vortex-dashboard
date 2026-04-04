import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  RefreshCw, CheckCircle2, XCircle, Loader2, Clock, Database,
  CalendarDays, ChevronDown
} from "lucide-react";
import { toast } from "sonner";
import type { DateRange } from "react-day-picker";

// Preset options
const PRESETS = [
  { label: "Останні 3 дні", days: 3 },
  { label: "Останні 7 днів", days: 7 },
  { label: "Останні 14 днів", days: 14 },
  { label: "Останні 30 днів", days: 30 },
] as const;

function formatDateUk(d: Date): string {
  return d.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

export default function Sync() {
  const utils = trpc.useUtils();

  // Preset or custom
  const [selectedPreset, setSelectedPreset] = useState<number | null>(3);
  const [customRange, setCustomRange] = useState<DateRange | undefined>(undefined);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const { data: syncStatus } = trpc.sync.status.useQuery(undefined, {
    refetchInterval: 3000,
  });
  const { data: syncLogs, isLoading: logsLoading } = trpc.sync.logs.useQuery();

  const triggerSync = trpc.sync.trigger.useMutation({
    onSuccess: (data) => {
      toast.success(data.message || "Синхронізацію запущено");
      utils.sync.status.invalidate();
      utils.sync.logs.invalidate();
    },
    onError: (err: { message: string }) => {
      toast.error("Помилка: " + err.message);
    },
  });

  // Compute what label to show on the trigger button
  const getSyncLabel = (): string => {
    if (selectedPreset !== null) {
      return PRESETS.find(p => p.days === selectedPreset)?.label ?? `Останні ${selectedPreset} днів`;
    }
    if (customRange?.from && customRange?.to) {
      return `${formatDateUk(customRange.from)} — ${formatDateUk(customRange.to)}`;
    }
    if (customRange?.from) {
      return `${formatDateUk(customRange.from)} — оберіть кінець`;
    }
    return "Оберіть діапазон";
  };

  const canSync = selectedPreset !== null || (customRange?.from && customRange?.to);

  const handleSync = () => {
    if (!canSync) {
      toast.warning("Оберіть діапазон синхронізації");
      return;
    }

    if (selectedPreset !== null) {
      triggerSync.mutate({ days: selectedPreset });
    } else if (customRange?.from && customRange?.to) {
      const dateFrom = Math.floor(startOfDay(customRange.from).getTime() / 1000);
      const dateTo = Math.floor(endOfDay(customRange.to).getTime() / 1000);
      triggerSync.mutate({ dateFrom, dateTo });
    }
  };

  const handlePresetClick = (days: number) => {
    setSelectedPreset(days);
    setCustomRange(undefined);
  };

  const handleCustomRange = (range: DateRange | undefined) => {
    setCustomRange(range);
    if (range?.from) {
      setSelectedPreset(null);
    }
    if (range?.from && range?.to) {
      setCalendarOpen(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Синхронізація</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Управління синхронізацією даних з Vortex ERP API. Дані завантажуються по 1 дню за раз з паузами між запитами.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Status card */}
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
                    <Badge variant={syncStatus.lastSync.status === "completed" ? "default" : syncStatus.lastSync.status === "failed" ? "destructive" : "secondary"}>
                      {syncStatus.lastSync.status === "completed" ? "Успішно"
                        : syncStatus.lastSync.status === "failed" ? "Помилка"
                        : "В процесі"}
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

        {/* Sync trigger card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Запустити синхронізацію
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Preset buttons */}
            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium">Готові варіанти:</p>
              <div className="grid grid-cols-2 gap-2">
                {PRESETS.map((preset) => (
                  <Button
                    key={preset.days}
                    variant={selectedPreset === preset.days ? "default" : "outline"}
                    size="sm"
                    className="justify-start text-xs"
                    onClick={() => handlePresetClick(preset.days)}
                    disabled={syncStatus?.isSyncing}
                  >
                    <CalendarDays className="h-3 w-3 mr-1.5" />
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Custom date range */}
            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium">Або оберіть власний діапазон:</p>
              <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant={selectedPreset === null && customRange?.from ? "default" : "outline"}
                    size="sm"
                    className="w-full justify-between text-xs"
                    disabled={syncStatus?.isSyncing}
                  >
                    <span className="flex items-center gap-1.5">
                      <CalendarDays className="h-3 w-3" />
                      {customRange?.from && customRange?.to
                        ? `${formatDateUk(customRange.from)} — ${formatDateUk(customRange.to)}`
                        : customRange?.from
                        ? `${formatDateUk(customRange.from)} — оберіть кінець`
                        : "Кастомний діапазон"}
                    </span>
                    <ChevronDown className="h-3 w-3 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="range"
                    selected={customRange}
                    onSelect={handleCustomRange}
                    numberOfMonths={2}
                    disabled={(date) => date > new Date()}
                  />
                  {customRange?.from && !customRange?.to && (
                    <p className="text-xs text-muted-foreground text-center pb-3">
                      Оберіть дату закінчення
                    </p>
                  )}
                </PopoverContent>
              </Popover>
            </div>

            {/* Trigger button */}
            <Button
              className="w-full"
              onClick={handleSync}
              disabled={syncStatus?.isSyncing || triggerSync.isPending || !canSync}
            >
              {syncStatus?.isSyncing || triggerSync.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              {syncStatus?.isSyncing
                ? "Синхронізація в процесі..."
                : `Синхронізувати: ${getSyncLabel()}`}
            </Button>

            <p className="text-xs text-muted-foreground">
              Дані завантажуються по 1 дню за раз з паузами між запитами, щоб не перевантажувати API Vortex.
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
                <TableHead>Дата запуску</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead className="text-right">Замовлень</TableHead>
                <TableHead className="text-right">Нових</TableHead>
                <TableHead className="text-right">Змінених</TableHead>
                <TableHead>Повідомлення / Помилка</TableHead>
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
                syncLogs.map((log: Record<string, unknown>) => (
                  <TableRow key={String(log.id)} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="text-xs whitespace-nowrap">
                      {new Date(log.startedAt as string).toLocaleString("uk-UA")}
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
                    <TableCell className="text-xs text-right font-mono">{String(log.ordersProcessed || 0)}</TableCell>
                    <TableCell className="text-xs text-right font-mono text-green-500">{String(log.newOrders || 0)}</TableCell>
                    <TableCell className="text-xs text-right font-mono text-yellow-500">{String(log.modifiedOrders || 0)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground truncate max-w-[220px]" title={String(log.errorMessage || "")}>
                      {String(log.errorMessage || "—")}
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
