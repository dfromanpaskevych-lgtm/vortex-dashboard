import { trpc } from "@/lib/trpc";
import { useState, useCallback } from "react";
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
  CalendarDays, ChevronDown, Coins, Bot, User, StopCircle, Check
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

/** Returns { dateFrom, dateTo } timestamps for the current calendar month (1st → today) */
function getCurrentMonthRange(): { dateFrom: number; dateTo: number; label: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  const label = from.toLocaleDateString("uk-UA", { month: "long", year: "numeric" });
  return { dateFrom: Math.floor(from.getTime() / 1000), dateTo: Math.floor(to.getTime() / 1000), label };
}

/** Returns { dateFrom, dateTo } timestamps for the current quarter (3 months: 1st of 2 months ago → today) */
function getCurrentQuarterRange(): { dateFrom: number; dateTo: number; label: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 2, 1, 0, 0, 0, 0);
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  const fromLabel = from.toLocaleDateString("uk-UA", { month: "long", year: "numeric" });
  const toLabel = to.toLocaleDateString("uk-UA", { month: "long", year: "numeric" });
  return { dateFrom: Math.floor(from.getTime() / 1000), dateTo: Math.floor(to.getTime() / 1000), label: `${fromLabel} — ${toLabel}` };
}

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
  // Special range: "month" | "quarter" | null
  const [selectedSpecial, setSelectedSpecial] = useState<"month" | "quarter" | null>(null);

  const { data: syncStatus } = trpc.sync.status.useQuery(undefined, {
    refetchInterval: 3000,
  });
  const { data: balanceStatus } = trpc.sync.balanceStatus.useQuery(undefined, {
    refetchInterval: 5000,
  });
  const { data: syncLogs, isLoading: logsLoading } = trpc.sync.logs.useQuery();
  const { data: syncRunsData, isLoading: runsLoading } = trpc.sync.runs.useQuery(undefined, {
    refetchInterval: 3000,
  });
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set());
  const toggleRun = useCallback((runId: string) => {
    setExpandedRuns(prev => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }, []);

  const triggerSync = trpc.sync.trigger.useMutation({
    onSuccess: (data) => {
      toast.success(data.message || "Синхронізацію запущено");
      utils.sync.status.invalidate();
      utils.sync.logs.invalidate();
      utils.sync.runs.invalidate();
    },
    onError: (err: { message: string }) => {
      toast.error("Помилка: " + err.message);
    },
  });

  const cancelSync = trpc.sync.cancel.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.info("Зупинка запрошена. Поточний чанк завершиться, наступні не запустяться.");
      } else {
        toast.warning(data.message || "Синхронізація не запущена");
      }
      utils.sync.status.invalidate();
      utils.sync.logs.invalidate();
      utils.sync.runs.invalidate();
    },
    onError: (err: { message: string }) => {
      toast.error("Помилка зупинки: " + err.message);
    },
  });

  const { data: cancelPendingData } = trpc.sync.cancelPending.useQuery(undefined, {
    refetchInterval: 2000,
  });
  const isCancelPending = cancelPendingData?.isCancelPending ?? false;

  const triggerEnrichBalances = trpc.sync.enrichBalances.useMutation({
    onSuccess: (data) => {
      toast.success(data.message || "Збагачення балансами запущено");
      utils.sync.balanceStatus.invalidate();
    },
    onError: (err: { message: string }) => {
      toast.error("Помилка: " + err.message);
    },
  });

  // Compute what label to show on the trigger button
  const getSyncLabel = (): string => {
    if (selectedSpecial === "month") return `Поточний місяць: ${getCurrentMonthRange().label}`;
    if (selectedSpecial === "quarter") return `Поточний квартал: ${getCurrentQuarterRange().label}`;
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

  const canSync = selectedSpecial !== null || selectedPreset !== null || (customRange?.from && customRange?.to);

  const handleSync = () => {
    if (!canSync) {
      toast.warning("Оберіть діапазон синхронізації");
      return;
    }

    if (selectedSpecial === "month") {
      const { dateFrom, dateTo } = getCurrentMonthRange();
      triggerSync.mutate({ dateFrom, dateTo });
    } else if (selectedSpecial === "quarter") {
      const { dateFrom, dateTo } = getCurrentQuarterRange();
      triggerSync.mutate({ dateFrom, dateTo });
    } else if (selectedPreset !== null) {
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
    setSelectedSpecial(null);
  };

  const handleSpecialClick = (type: "month" | "quarter") => {
    setSelectedSpecial(type);
    setSelectedPreset(null);
    setCustomRange(undefined);
  };

  // BUG FIX #1: Don't auto-close popover on range select.
  // Let user pick both dates freely, then click "Застосувати" to confirm.
  const handleCustomRange = (range: DateRange | undefined) => {
    setCustomRange(range);
    if (range?.from) {
      setSelectedPreset(null);
      setSelectedSpecial(null);
    }
  };

  const handleApplyCustomRange = () => {
    setCalendarOpen(false);
  };

  const handleClearCustomRange = () => {
    setCustomRange(undefined);
  };

  const isSyncing = syncStatus?.isSyncing || triggerSync.isPending;
  const isEnriching = balanceStatus?.isEnriching || triggerEnrichBalances.isPending;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Синхронізація</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Управління синхронізацією даних з Vortex ERP API. Дані завантажуються по 1 дню за раз.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
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
                <span className="text-sm text-muted-foreground">Синхронізація:</span>
                <Badge variant={isSyncing ? "default" : "secondary"}>
                  {isSyncing ? (
                    <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> В процесі...</>
                  ) : (
                    <><CheckCircle2 className="h-3 w-3 mr-1" /> Готово</>
                  )}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Баланси:</span>
                <Badge variant={isEnriching ? "default" : "secondary"}>
                  {isEnriching ? (
                    <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Збагачення...</>
                  ) : (
                    <><CheckCircle2 className="h-3 w-3 mr-1" /> Готово</>
                  )}
                </Badge>
              </div>
              {syncStatus?.lastSync && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Остання синхр.:</span>
                    <span className="text-xs">
                      {new Date(syncStatus.lastSync.startedAt).toLocaleString("uk-UA")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Результат:</span>
                    <Badge variant={syncStatus.lastSync.status === "completed" ? "default" : syncStatus.lastSync.status === "failed" ? "destructive" : "secondary"} className="text-[10px]">
                      {syncStatus.lastSync.status === "completed" ? "Успішно"
                        : syncStatus.lastSync.status === "failed" ? "Помилка"
                        : "В процесі"}
                    </Badge>
                  </div>
                  {syncStatus.lastSync.ordersProcessed != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Оброблено:</span>
                      <span className="text-sm font-mono">{syncStatus.lastSync.ordersProcessed} замовлень</span>
                    </div>
                  )}
                </>
              )}
              {syncStatus?.nextScheduledSync && (
                <div className="flex items-center justify-between border-t pt-3 mt-1">
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <Bot className="h-3 w-3" /> Авто-синхр.:
                  </span>
                  <span className="text-xs">
                    {new Date(syncStatus.nextScheduledSync).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Sync trigger card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Синхронізація замовлень
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
                    disabled={isSyncing}
                  >
                    <CalendarDays className="h-3 w-3 mr-1.5" />
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Month / Quarter quick-select */}
            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium">Швидкий вибір:</p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={selectedSpecial === "month" ? "default" : "outline"}
                  size="sm"
                  className={`justify-start text-xs ${selectedSpecial === "month" ? "bg-blue-600 hover:bg-blue-700" : ""}`}
                  onClick={() => handleSpecialClick("month")}
                  disabled={isSyncing}
                >
                  <CalendarDays className="h-3 w-3 mr-1.5" />
                  Поточний місяць
                </Button>
                <Button
                  variant={selectedSpecial === "quarter" ? "default" : "outline"}
                  size="sm"
                  className={`justify-start text-xs ${selectedSpecial === "quarter" ? "bg-purple-600 hover:bg-purple-700" : ""}`}
                  onClick={() => handleSpecialClick("quarter")}
                  disabled={isSyncing}
                >
                  <CalendarDays className="h-3 w-3 mr-1.5" />
                  Поточний квартал
                </Button>
              </div>
            </div>

            {/* Custom date range — BUG FIX #1: no auto-close, explicit "Apply" button */}
            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium">Або власний діапазон:</p>
              <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant={selectedPreset === null && selectedSpecial === null && customRange?.from ? "default" : "outline"}
                    size="sm"
                    className="w-full justify-between text-xs"
                    disabled={isSyncing}
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
                  <div className="flex items-center justify-between p-3 border-t">
                    <div className="text-xs text-muted-foreground">
                      {customRange?.from && customRange?.to ? (
                        <span className="text-green-500 font-medium">
                          {formatDateUk(customRange.from)} — {formatDateUk(customRange.to)}
                        </span>
                      ) : customRange?.from ? (
                        <span className="text-yellow-500">Оберіть дату закінчення</span>
                      ) : (
                        <span>Оберіть дату початку</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {customRange?.from && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs h-7"
                          onClick={handleClearCustomRange}
                        >
                          Очистити
                        </Button>
                      )}
                      <Button
                        size="sm"
                        className="text-xs h-7"
                        onClick={handleApplyCustomRange}
                        disabled={!customRange?.from || !customRange?.to}
                      >
                        <Check className="h-3 w-3 mr-1" />
                        Застосувати
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {/* Trigger button */}
            <Button
              className="w-full"
              onClick={handleSync}
              disabled={isSyncing || !canSync}
            >
              {isSyncing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              {isSyncing
                ? "Синхронізація в процесі..."
                : `Синхронізувати: ${getSyncLabel()}`}
            </Button>

            {/* Stop button — visible only when sync is running */}
            {isSyncing && (
              <Button
                className="w-full"
                variant="destructive"
                onClick={() => cancelSync.mutate()}
                disabled={isCancelPending || cancelSync.isPending}
              >
                {isCancelPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Зупинка після поточного чанку...</>
                ) : (
                  <><StopCircle className="h-4 w-4 mr-2" /> Зупинити синхронізацію</>
                )}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Balance enrichment card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Coins className="h-4 w-4" />
              Збагачення балансами
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Завантажує поточний баланс для замовлень, у яких він ще не заповнений. Виконується по 200 замовлень за раз з паузами між запитами.
            </p>
            <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
              <p>⏱ Орієнтовний час: ~7 хв на 200 замовлень</p>
              <p>⚠️ Не блокує синхронізацію — працює паралельно</p>
            </div>
            <Button
              className="w-full"
              variant="outline"
              onClick={() => triggerEnrichBalances.mutate({ limit: 200 })}
              disabled={isEnriching}
            >
              {isEnriching ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Coins className="h-4 w-4 mr-2" />
              )}
              {isEnriching
                ? "Збагачення в процесі..."
                : "Збагатити балансами (200 замовлень)"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Запускайте кілька разів, поки всі замовлення не отримають баланс.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Sync History — Grouped by Run */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Історія синхронізацій
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {runsLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />
            ))
          ) : !syncRunsData || (syncRunsData.runs.length === 0 && syncRunsData.legacy.length === 0) ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Синхронізацій ще не було</div>
          ) : (
            <>
              {/* Grouped runs */}
              {syncRunsData.runs.map((run: Record<string, unknown>) => {
                const runId = String(run.runId);
                const isExpanded = expandedRuns.has(runId);
                const startedAt = run.startedAt ? new Date(run.startedAt as string) : null;
                const completedAt = run.completedAt ? new Date(run.completedAt as string) : null;
                const durationMs = startedAt && completedAt ? completedAt.getTime() - startedAt.getTime() : null;
                const durationStr = durationMs != null
                  ? durationMs < 60000 ? `${Math.round(durationMs / 1000)}с` : `${Math.floor(durationMs / 60000)}хв ${Math.round((durationMs % 60000) / 1000)}с`
                  : run.status === "running" ? "..." : "—";
                const chunks = (run.chunks as unknown[]) ?? [];
                const totalChunks = Number(run.totalChunks) || chunks.length || 1;
                const completedChunks = Number(run.completedChunks) || 0;
                const failedChunks = Number(run.failedChunks) || 0;
                const statusColor = run.status === "completed" ? "text-green-500" : run.status === "failed" ? "text-red-500" : run.status === "cancelled" ? "text-orange-500" : "text-blue-500";

                return (
                  <div key={runId} className="border rounded-lg overflow-hidden">
                    {/* Parent run row */}
                    <button
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
                      onClick={() => toggleRun(runId)}
                    >
                      <ChevronDown className={`h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} />

                      {/* Status icon */}
                      <span className={`flex-shrink-0 ${statusColor}`}>
                        {run.status === "completed" ? <CheckCircle2 className="h-4 w-4" /> :
                         run.status === "failed" ? <XCircle className="h-4 w-4" /> :
                         run.status === "cancelled" ? <StopCircle className="h-4 w-4" /> :
                         <Loader2 className="h-4 w-4 animate-spin" />}
                      </span>

                      {/* Date range */}
                      <span className="font-medium text-sm flex-1 min-w-0">
                        {run.dateFrom && run.dateTo ? `${run.dateFrom} — ${run.dateTo}` : "—"}
                        <span className="ml-2 text-xs text-muted-foreground font-normal">
                          ({totalChunks} {totalChunks === 1 ? "чанк" : totalChunks < 5 ? "чанки" : "чанків"})
                        </span>
                      </span>

                      {/* Type badge */}
                      <Badge variant="outline" className="text-[10px] gap-1 flex-shrink-0">
                        {run.syncType === "auto" ? <><Bot className="h-3 w-3" /> Авто</> : <><User className="h-3 w-3" /> Ручна</>}
                      </Badge>

                      {/* Chunk progress */}
                      {run.status === "running" ? (
                        <span className="text-xs text-muted-foreground flex-shrink-0">Чанк {completedChunks + failedChunks + 1}/{totalChunks}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground flex-shrink-0">{completedChunks}/{totalChunks} успішно</span>
                      )}

                      {/* Stats */}
                      <span className="text-xs text-muted-foreground flex-shrink-0 hidden sm:block">
                        {Number(run.ordersProcessed) || 0} зам.
                        {Number(run.newOrders) > 0 && <span className="text-green-500 ml-1">+{Number(run.newOrders)}</span>}
                        {Number(run.modifiedOrders) > 0 && <span className="text-yellow-500 ml-1">~{Number(run.modifiedOrders)}</span>}
                      </span>

                      {/* Duration */}
                      <span className="text-xs font-mono text-muted-foreground flex-shrink-0">{durationStr}</span>

                      {/* Time */}
                      <span className="text-xs text-muted-foreground flex-shrink-0 hidden md:block">
                        {startedAt ? startedAt.toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </span>
                    </button>

                    {/* Expanded chunk list */}
                    {isExpanded && chunks.length > 0 && (
                      <div className="border-t bg-muted/20">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/40">
                              <TableHead className="pl-10 text-xs">#</TableHead>
                              <TableHead className="text-xs">Діапазон</TableHead>
                              <TableHead className="text-xs">Початок</TableHead>
                              <TableHead className="text-xs">Тривалість</TableHead>
                              <TableHead className="text-xs">Статус</TableHead>
                              <TableHead className="text-xs text-right">Оброблено</TableHead>
                              <TableHead className="text-xs text-right">Нових</TableHead>
                              <TableHead className="text-xs text-right">Змінених</TableHead>
                              <TableHead className="text-xs">Помилка</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(chunks as Record<string, unknown>[]).map((chunk, ci) => {
                              const cStart = chunk.startedAt ? new Date(chunk.startedAt as string) : null;
                              const cEnd = chunk.completedAt ? new Date(chunk.completedAt as string) : null;
                              const cDurMs = cStart && cEnd ? cEnd.getTime() - cStart.getTime() : null;
                              const cDurStr = cDurMs != null
                                ? cDurMs < 60000 ? `${Math.round(cDurMs / 1000)}с` : `${Math.floor(cDurMs / 60000)}хв ${Math.round((cDurMs % 60000) / 1000)}с`
                                : chunk.status === "running" ? "..." : "—";
                              return (
                                <TableRow key={String(chunk.id ?? ci)} className="hover:bg-muted/30">
                                  <TableCell className="pl-10 text-xs text-muted-foreground">{Number(chunk.chunkIndex) || ci + 1}</TableCell>
                                  <TableCell className="text-xs font-medium">
                                    {chunk.dateFrom && chunk.dateTo ? `${chunk.dateFrom} — ${chunk.dateTo}` : "—"}
                                  </TableCell>
                                  <TableCell className="text-xs whitespace-nowrap">
                                    {cStart ? cStart.toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}
                                  </TableCell>
                                  <TableCell className="text-xs font-mono text-muted-foreground">{cDurStr}</TableCell>
                                  <TableCell>
                                    <Badge
                                      variant={chunk.status === "completed" ? "default" : chunk.status === "failed" ? "destructive" : chunk.status === "cancelled" ? "outline" : "secondary"}
                                      className={`text-[10px] ${chunk.status === "cancelled" ? "border-orange-500 text-orange-500" : ""}`}
                                    >
                                      {chunk.status === "completed" ? <><CheckCircle2 className="h-3 w-3 mr-1" /> Успішно</> :
                                       chunk.status === "failed" ? <><XCircle className="h-3 w-3 mr-1" /> Помилка</> :
                                       chunk.status === "cancelled" ? <><StopCircle className="h-3 w-3 mr-1" /> Скасовано</> :
                                       <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> В процесі</>}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-xs text-right font-mono">{Number(chunk.ordersProcessed) || 0}</TableCell>
                                  <TableCell className="text-xs text-right font-mono text-green-500">{Number(chunk.newOrders) || 0}</TableCell>
                                  <TableCell className="text-xs text-right font-mono text-yellow-500">{Number(chunk.modifiedOrders) || 0}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground truncate max-w-[160px]" title={String(chunk.errorMessage || "")}>
                                    {String(chunk.errorMessage || "—")}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                    {isExpanded && chunks.length === 0 && (
                      <div className="px-10 py-3 text-xs text-muted-foreground border-t">Чанки ще виконуються...</div>
                    )}
                  </div>
                );
              })}

              {/* Legacy sync logs (no runId) */}
              {syncRunsData.legacy.length > 0 && (
                <>
                  {syncRunsData.runs.length > 0 && (
                    <p className="text-xs text-muted-foreground pt-2 pb-1">Старі записи (до групування):</p>
                  )}
                  {(syncRunsData.legacy as Record<string, unknown>[]).map((log) => {
                    const startedAt = log.startedAt ? new Date(log.startedAt as string) : null;
                    const completedAt = log.completedAt ? new Date(log.completedAt as string) : null;
                    const durationMs = startedAt && completedAt ? completedAt.getTime() - startedAt.getTime() : null;
                    const durationStr = durationMs != null
                      ? durationMs < 60000 ? `${Math.round(durationMs / 1000)}с` : `${Math.floor(durationMs / 60000)}хв ${Math.round((durationMs % 60000) / 1000)}с`
                      : log.status === "running" ? "..." : "—";
                    const statusColor = log.status === "completed" ? "text-green-500" : log.status === "failed" ? "text-red-500" : log.status === "cancelled" ? "text-orange-500" : "text-blue-500";
                    return (
                      <div key={String(log.id)} className="border rounded-lg px-4 py-3 flex items-center gap-3 opacity-70">
                        <span className={`flex-shrink-0 ${statusColor}`}>
                          {log.status === "completed" ? <CheckCircle2 className="h-4 w-4" /> :
                           log.status === "failed" ? <XCircle className="h-4 w-4" /> :
                           log.status === "cancelled" ? <StopCircle className="h-4 w-4" /> :
                           <Loader2 className="h-4 w-4 animate-spin" />}
                        </span>
                        <span className="text-sm flex-1">
                          {log.dateFrom && log.dateTo ? `${log.dateFrom} — ${log.dateTo}` : "—"}
                        </span>
                        <Badge variant="outline" className="text-[10px] gap-1">
                          {log.syncType === "auto" ? <><Bot className="h-3 w-3" /> Авто</> : <><User className="h-3 w-3" /> Ручна</>}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{Number(log.ordersProcessed) || 0} зам.</span>
                        <span className="text-xs font-mono text-muted-foreground">{durationStr}</span>
                        <span className="text-xs text-muted-foreground hidden md:block">
                          {startedAt ? startedAt.toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                        </span>
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
