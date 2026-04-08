import React, { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, ChevronUp, ChevronDown, ChevronsUpDown, Filter, X, Download, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CalendarDays } from "lucide-react";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { toast } from "sonner";

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className?: string }> = {
  waiting:         { label: "Очікування",            variant: "secondary" },
  pending:         { label: "В обробці",             variant: "outline",     className: "border-blue-500 text-blue-400" },
  expected:        { label: "Очікується",            variant: "outline",     className: "border-yellow-500 text-yellow-400" },
  in_stock:        { label: "На складі",             variant: "outline",     className: "border-emerald-500 text-emerald-400" },
  complete:        { label: "Виконано",              variant: "default",     className: "bg-emerald-700 text-white border-0" },
  canceled:        { label: "Скасовано",             variant: "destructive" },
  returned:        { label: "Повернуто",             variant: "outline",     className: "border-orange-500 text-orange-400" },
  partly_returned: { label: "Часткове повернення",   variant: "outline",     className: "border-orange-400 text-orange-300" },
  // Vortex API string variants
  "Parts Return":  { label: "Повернення запчастин",  variant: "outline",     className: "border-orange-500 text-orange-400" },
  archived:        { label: "Архів",                 variant: "secondary" },
};

function formatDate(ts: number | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatPrice(val: string | number | null | undefined): string {
  if (val == null || val === "") return "—";
  const n = Number(val);
  if (isNaN(n)) return String(val);
  return n.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Show "—" for empty/null text fields */
function showText(val: string | null | undefined, fallback = "—"): string {
  if (!val || val.trim() === "") return fallback;
  return val.trim();
}

export default function Orders() {
  const [search, setSearch] = useState("");
  const [manager, setManager] = useState("");
  const [status, setStatus] = useState("");
  const [brand, setBrand] = useState("");
  const [client, setClient] = useState("");
  const [sortField, setSortField] = useState("created");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [qtyMin, setQtyMin] = useState("");
  const [qtyMax, setQtyMax] = useState("");
  const [basePriceCurrency, setBasePriceCurrency] = useState("");

  // Convert date strings to unix timestamps
  const dateFromTs = useMemo(() => {
    if (!dateFrom) return undefined;
    return Math.floor(new Date(dateFrom + "T00:00:00").getTime() / 1000);
  }, [dateFrom]);
  const dateToTs = useMemo(() => {
    if (!dateTo) return undefined;
    return Math.floor(new Date(dateTo + "T23:59:59").getTime() / 1000);
  }, [dateTo]);

  const queryInput = useMemo(() => ({
    search: search || undefined,
    manager: manager || undefined,
    status: status || undefined,
    brand: brand || undefined,
    client: client || undefined,
    dateFrom: dateFromTs,
    dateTo: dateToTs,
    qtyMin: qtyMin ? Number(qtyMin) : undefined,
    qtyMax: qtyMax ? Number(qtyMax) : undefined,
    basePriceCurrency: basePriceCurrency || undefined,
    sortField,
    sortDir,
    page,
    pageSize,
  }), [search, manager, status, brand, client, dateFromTs, dateToTs, qtyMin, qtyMax, basePriceCurrency, sortField, sortDir, page, pageSize]);

  const { data, isLoading } = trpc.orders.list.useQuery(queryInput);
  const { data: filterOptions } = trpc.orders.filterOptions.useQuery();

  const rows = data?.rows || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
    setPage(1);
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return <ChevronsUpDown className="h-3 w-3 opacity-30" />;
    return sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />;
  };

  const clearFilters = () => {
    setSearch("");
    setManager("");
    setStatus("");
    setBrand("");
    setClient("");
    setDateFrom("");
    setDateTo("");
    setQtyMin("");
    setQtyMax("");
    setBasePriceCurrency("");
    setPage(1);
  };

  const hasFilters = search || manager || status || brand || client || dateFrom || dateTo || qtyMin || qtyMax || basePriceCurrency;

  const handleExportExcel = () => {
    toast.info("Генерація Excel файлу...");
    const params = new URLSearchParams();
    if (manager) params.set("manager", manager);
    if (status) params.set("status", status);
    if (brand) params.set("brand", brand);
    if (client) params.set("client", client);
    if (search) params.set("search", search);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    const qs = params.toString();
    const link = document.createElement("a");
    link.href = `/api/export/excel${qs ? `?${qs}` : ""}`;
    link.download = "orders.xlsx";
    link.click();
  };

  const tableRows = useMemo(() => {
    return rows.map((row: any) => {
      const salePrice = row.price || row.retailPrice;
      const qty = Number(row.qty) || 1;
      // Дельта за 1 шт = price - basePrice (обидва в UAH)
      const deltaPerUnit = row.basePrice != null && salePrice != null
        ? (Number(salePrice) - Number(row.basePrice))
        : null;
      // Дельта в колонці = дельта за 1 шт (читається як маржа за 1 одиницю)
      const delta = deltaPerUnit != null ? deltaPerUnit.toFixed(2) : null;
      // Base price in UAH: if fixedRate exists, basePrice × fixedRate; otherwise basePrice (assumed UAH)
      const fixedRate = row.fixedRate ? Number(row.fixedRate) : null;
      const basePriceUah = row.basePrice
        ? (fixedRate && fixedRate > 0 ? (Number(row.basePrice) * fixedRate).toFixed(2) : null)
        : null;
      // MANUS розрахунок на кількість
      // MANUS Продажна = price × qty
      // MANUS Дельта = (price - basePrice) × qty
      // MANUS Вхідна = MANUS Продажна − MANUS Дельта
      const manusSaleTotal = salePrice ? (Number(salePrice) * qty) : null;
      const manusDelta = deltaPerUnit != null ? (deltaPerUnit * qty) : null;
      const manusInputTotal = manusSaleTotal != null && manusDelta != null
        ? (manusSaleTotal - manusDelta)
        : null;
      return {
        num: row.vortexOrderId,
        manager: showText(row.managerName),
        brand: showText(row.brandName),
        article: showText(row.code),
        description: showText(row.description),
        status: row.status || "",
        warehouse: showText(row.whName),
        created: formatDate(row.createdTs),
        arrival: formatDate(row.deliveryTime),
        qty: row.qty || "\u2014",
        inputPrice: formatPrice(row.basePrice),
        inputCurrency: row.basePriceCurrency ? row.basePriceCurrency.toUpperCase() : "\u2014",
        basePriceUah: basePriceUah ? formatPrice(basePriceUah) : "\u2014",
        fixedRate: fixedRate ? fixedRate.toFixed(2) : "\u2014",
        fixedRateDate: row.fixedRateDate ? row.fixedRateDate : "\u2014",
        salePrice: formatPrice(salePrice),
        delta: delta ? formatPrice(delta) : "\u2014",
        saleCurrency: row.itemCurrency ? row.itemCurrency.toUpperCase() : "\u2014",
        currentBalance: formatPrice(row.balanceCurrencyTotal),
        balanceCurrency: row.balanceCurrency ? row.balanceCurrency.toUpperCase() : "—",
        client: showText(row.clientName),
        clientType: "—",
        markupGroup: "—",
        delivery: showText(row.deliveryName),
        phone: row.customerPhone && row.customerPhone.trim() !== "" ? row.customerPhone.trim() : "немає номеру",
        issueDoc: showText(row.trackNumber, "—"),
        issueDate: formatDate(row.realDeliveryTime),
        supplierBalance: formatPrice(row.supplierTotal),
        supplierCurrency: row.supplierCurrency ? row.supplierCurrency.toUpperCase() : "\u2014",
        invoicePaymentDate: formatDate(row.rgTimestamp),
        manusDelta: manusDelta != null ? formatPrice(manusDelta.toFixed(2)) : "\u2014",
        manusSaleTotal: manusSaleTotal != null ? formatPrice(manusSaleTotal.toFixed(2)) : "\u2014",
        manusInputTotal: manusInputTotal != null ? formatPrice(manusInputTotal.toFixed(2)) : "\u2014",
      };
    });
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Замовлення</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Всього: {total} замовлень
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExportExcel}>
            <Download className="h-4 w-4 mr-1" />
            Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className={showFilters ? "bg-accent" : ""}
          >
            <Filter className="h-4 w-4 mr-1" />
            Фільтри
          </Button>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="h-4 w-4 mr-1" />
              Очистити
            </Button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Пошук по всіх полях..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="pl-10"
        />
      </div>

      {/* Filters */}
      {showFilters && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Дата від</label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                  className="h-9"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Дата до</label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                  className="h-9"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Менеджер</label>
                <Select value={manager} onValueChange={(v) => { setManager(v === "_all" ? "" : v); setPage(1); }}>
                  <SelectTrigger><SelectValue placeholder="Всі менеджери" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">Всі менеджери</SelectItem>
                    {filterOptions?.managers.map((m) => (
                      <SelectItem key={m} value={m}>{m.length > 40 ? m.slice(0, 40) + "..." : m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Статус</label>
                <Select value={status} onValueChange={(v) => { setStatus(v === "_all" ? "" : v); setPage(1); }}>
                  <SelectTrigger><SelectValue placeholder="Всі статуси" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">Всі статуси</SelectItem>
                    {filterOptions?.statuses.map((s) => (
                      <SelectItem key={s} value={s}>{STATUS_MAP[s]?.label || s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Бренд</label>
                <Select value={brand} onValueChange={(v) => { setBrand(v === "_all" ? "" : v); setPage(1); }}>
                  <SelectTrigger><SelectValue placeholder="Всі бренди" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">Всі бренди</SelectItem>
                    {filterOptions?.brands.map((b) => (
                      <SelectItem key={b} value={b}>{b}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Клієнт</label>
                <Select value={client} onValueChange={(v) => { setClient(v === "_all" ? "" : v); setPage(1); }}>
                  <SelectTrigger><SelectValue placeholder="Всі клієнти" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">Всі клієнти</SelectItem>
                    {filterOptions?.clients.map((c) => (
                      <SelectItem key={c} value={c}>{c.length > 40 ? c.slice(0, 40) + "..." : c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Вхідна валюта</label>
                <Select value={basePriceCurrency} onValueChange={(v) => { setBasePriceCurrency(v === "_all" ? "" : v); setPage(1); }}>
                  <SelectTrigger><SelectValue placeholder="Всі валюти" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">Всі валюти</SelectItem>
                    <SelectItem value="uah">UAH (гривня)</SelectItem>
                    <SelectItem value="eur">EUR (євро)</SelectItem>
                    <SelectItem value="usd">USD (долар)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Кількість від</label>
                <Input
                  type="number"
                  min={1}
                  placeholder="Напр. 2"
                  value={qtyMin}
                  onChange={(e) => { setQtyMin(e.target.value); setPage(1); }}
                  className="h-9"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Кількість до</label>
                <Input
                  type="number"
                  min={1}
                  placeholder="Напр. 10"
                  value={qtyMax}
                  onChange={(e) => { setQtyMax(e.target.value); setPage(1); }}
                  className="h-9"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card className="overflow-hidden">
        <ScrollArea className="w-full">
          <div className="min-w-[2400px]">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-[70px] cursor-pointer whitespace-nowrap" onClick={() => handleSort("num")}>
                    <div className="flex items-center gap-1">№ <SortIcon field="num" /></div>
                  </TableHead>
                  <TableHead className="w-[180px] cursor-pointer whitespace-nowrap" onClick={() => handleSort("manager")}>
                    <div className="flex items-center gap-1">Менеджер <SortIcon field="manager" /></div>
                  </TableHead>
                  <TableHead className="w-[100px] cursor-pointer whitespace-nowrap" onClick={() => handleSort("brand")}>
                    <div className="flex items-center gap-1">Бренд <SortIcon field="brand" /></div>
                  </TableHead>
                  <TableHead className="w-[110px] cursor-pointer whitespace-nowrap" onClick={() => handleSort("article")}>
                    <div className="flex items-center gap-1">Артикул <SortIcon field="article" /></div>
                  </TableHead>
                  <TableHead className="w-[180px] whitespace-nowrap">Опис</TableHead>
                  <TableHead className="w-[100px] cursor-pointer whitespace-nowrap" onClick={() => handleSort("status")}>
                    <div className="flex items-center gap-1">Статус <SortIcon field="status" /></div>
                  </TableHead>
                  <TableHead className="w-[160px] whitespace-nowrap">Склад</TableHead>
                  <TableHead className="w-[100px] cursor-pointer whitespace-nowrap" onClick={() => handleSort("created")}>
                    <div className="flex items-center gap-1">Оформлено <SortIcon field="created" /></div>
                  </TableHead>
                  <TableHead className="w-[100px] whitespace-nowrap">Прибуття</TableHead>
                  <TableHead className="w-[60px] cursor-pointer whitespace-nowrap text-right" onClick={() => handleSort("quantity")}>
                    <div className="flex items-center justify-end gap-1">К-сть <SortIcon field="quantity" /></div>
                  </TableHead>
                  <TableHead className="w-[90px] cursor-pointer whitespace-nowrap text-right" onClick={() => handleSort("inputPrice")}>
                    <div className="flex items-center justify-end gap-1">Вхідна ціна <SortIcon field="inputPrice" /></div>
                  </TableHead>
                  <TableHead className="w-[70px] whitespace-nowrap">Валюта вхід.</TableHead>
                  <TableHead className="w-[100px] whitespace-nowrap text-right">Вхідна (грн)</TableHead>
                  <TableHead className="w-[70px] whitespace-nowrap text-right">Курс</TableHead>
                  <TableHead className="w-[110px] whitespace-nowrap">Дата фіксації курсу</TableHead>
                  <TableHead className="w-[90px] cursor-pointer whitespace-nowrap text-right" onClick={() => handleSort("salePrice")}>
                    <div className="flex items-center justify-end gap-1">Продаж <SortIcon field="salePrice" /></div>
                  </TableHead>
                  <TableHead className="w-[80px] whitespace-nowrap text-right">Дельта</TableHead>
                  <TableHead className="w-[70px] whitespace-nowrap">Валюта продаж</TableHead>
                  <TableHead className="w-[110px] whitespace-nowrap text-right">Поточний баланс</TableHead>
                  <TableHead className="w-[80px] whitespace-nowrap">Валюта баланс</TableHead>
                  <TableHead className="w-[160px] cursor-pointer whitespace-nowrap" onClick={() => handleSort("client")}>
                    <div className="flex items-center gap-1">Клієнт <SortIcon field="client" /></div>
                  </TableHead>
                  <TableHead className="w-[90px] whitespace-nowrap">Тип клієнта</TableHead>
                  <TableHead className="w-[100px] whitespace-nowrap">Група націнок</TableHead>
                  <TableHead className="w-[140px] whitespace-nowrap">Доставка</TableHead>
                  <TableHead className="w-[130px] whitespace-nowrap">Номер телефону</TableHead>
                  <TableHead className="w-[130px] whitespace-nowrap">Документ видачі</TableHead>
                  <TableHead className="w-[100px] whitespace-nowrap">Дата видачі</TableHead>
                  <TableHead className="w-[100px] whitespace-nowrap text-right">Баланс постач.</TableHead>
                  <TableHead className="w-[80px] whitespace-nowrap">Валюта постач.</TableHead>
                  <TableHead className="w-[130px] whitespace-nowrap">Дата оплати накладної</TableHead>
                  <TableHead className="w-[110px] whitespace-nowrap text-right bg-blue-950/30 text-blue-300">MANUS Дельта</TableHead>
                  <TableHead className="w-[110px] whitespace-nowrap text-right bg-blue-950/30 text-blue-300">MANUS Продажна</TableHead>
                  <TableHead className="w-[110px] whitespace-nowrap text-right bg-blue-950/30 text-blue-300">MANUS Вхідна</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 32 }).map((_, j) => (
                        <TableCell key={j}>
                          <div className="h-4 bg-muted animate-pulse rounded" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : tableRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={33} className="text-center py-12 text-muted-foreground">
                      Замовлення не знайдено
                    </TableCell>
                  </TableRow>
                ) : (
                  tableRows.map((row: any, idx: number) => (
                    <TableRow key={idx} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="font-mono text-xs">{row.num}</TableCell>
                      <TableCell className="text-xs truncate max-w-[180px]" title={row.manager}>{row.manager}</TableCell>
                      <TableCell className="text-xs">{row.brand}</TableCell>
                      <TableCell className="font-mono text-xs">{row.article}</TableCell>
                      <TableCell className="text-xs truncate max-w-[180px]" title={row.description}>{row.description}</TableCell>
                      <TableCell>
                        {row.status && (
                          <Badge variant={STATUS_MAP[row.status]?.variant || "secondary"} className="text-[10px] px-1.5 py-0">
                            {STATUS_MAP[row.status]?.label || row.status}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs truncate max-w-[160px]" title={row.warehouse}>{row.warehouse}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{row.created}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{row.arrival}</TableCell>
                      <TableCell className="text-xs text-right">{row.qty}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{row.inputPrice}</TableCell>
                      <TableCell className="text-xs uppercase">{row.inputCurrency}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{row.basePriceUah}</TableCell>
                      <TableCell className="text-xs text-right font-mono text-muted-foreground">{row.fixedRate}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{row.fixedRateDate}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{row.salePrice}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{row.delta}</TableCell>
                      <TableCell className="text-xs uppercase">{row.saleCurrency}</TableCell>
                      <TableCell className="text-xs text-right font-mono text-muted-foreground">{row.currentBalance}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.balanceCurrency}</TableCell>
                      <TableCell className="text-xs truncate max-w-[160px]" title={row.client}>{row.client}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.clientType}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.markupGroup}</TableCell>
                      <TableCell className="text-xs truncate max-w-[140px]" title={row.delivery}>{row.delivery}</TableCell>
                      <TableCell className={`text-xs font-mono ${row.phone === "немає номеру" ? "text-muted-foreground italic" : ""}`}>{row.phone}</TableCell>
                      <TableCell className="text-xs font-mono truncate max-w-[130px]" title={row.issueDoc}>{row.issueDoc}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{row.issueDate}</TableCell>
                      <TableCell className="text-xs text-right font-mono text-muted-foreground">{row.supplierBalance}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.supplierCurrency}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{row.invoicePaymentDate}</TableCell>
                      <TableCell className="text-xs text-right font-mono font-semibold text-blue-400 bg-blue-950/20">{row.manusDelta}</TableCell>
                      <TableCell className="text-xs text-right font-mono font-semibold text-blue-400 bg-blue-950/20">{row.manusSaleTotal}</TableCell>
                      <TableCell className="text-xs text-right font-mono font-semibold text-blue-400 bg-blue-950/20">{row.manusInputTotal}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </Card>

      {/* Pagination */}
      {totalPages > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Рядків на сторінці:</span>
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
              <SelectTrigger className="h-8 w-[70px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
                <SelectItem value="200">200</SelectItem>
              </SelectContent>
            </Select>
            <span className="ml-2">
              {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} з {total}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(1)} title="Перша сторінка">
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(page - 1)} title="Попередня">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {/* Page number buttons */}
            {(() => {
              const pages: number[] = [];
              const delta = 2;
              const left = Math.max(1, page - delta);
              const right = Math.min(totalPages, page + delta);
              for (let i = left; i <= right; i++) pages.push(i);
              const result: React.ReactNode[] = [];
              if (left > 1) {
                result.push(<Button key={1} variant={page === 1 ? "default" : "outline"} size="icon" className="h-8 w-8" onClick={() => setPage(1)}>1</Button>);
                if (left > 2) result.push(<span key="l-ellipsis" className="px-1 text-muted-foreground">…</span>);
              }
              pages.forEach(p => result.push(
                <Button key={p} variant={page === p ? "default" : "outline"} size="icon" className="h-8 w-8" onClick={() => setPage(p)}>{p}</Button>
              ));
              if (right < totalPages) {
                if (right < totalPages - 1) result.push(<span key="r-ellipsis" className="px-1 text-muted-foreground">…</span>);
                result.push(<Button key={totalPages} variant={page === totalPages ? "default" : "outline"} size="icon" className="h-8 w-8" onClick={() => setPage(totalPages)}>{totalPages}</Button>);
              }
              return result;
            })()}
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage(page + 1)} title="Наступна">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage(totalPages)} title="Остання сторінка">
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
