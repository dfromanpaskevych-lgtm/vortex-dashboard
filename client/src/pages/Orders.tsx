import { trpc } from "@/lib/trpc";
import { useState, useMemo } from "react";
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
import { Search, ChevronUp, ChevronDown, ChevronsUpDown, Filter, X, Download } from "lucide-react";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { toast } from "sonner";

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  waiting: { label: "Очікування", variant: "secondary" },
  pending: { label: "В обробці", variant: "default" },
  expected: { label: "Очікується", variant: "outline" },
  in_stock: { label: "На складі", variant: "default" },
  complete: { label: "Виконано", variant: "default" },
  canceled: { label: "Скасовано", variant: "destructive" },
  returned: { label: "Повернуто", variant: "destructive" },
  archived: { label: "Архів", variant: "secondary" },
};

function formatDate(ts: number | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatPrice(val: string | number | null | undefined): string {
  if (val == null || val === "") return "";
  const n = Number(val);
  if (isNaN(n)) return String(val);
  return n.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  const pageSize = 50;

  const queryInput = useMemo(() => ({
    search: search || undefined,
    manager: manager || undefined,
    status: status || undefined,
    brand: brand || undefined,
    client: client || undefined,
    sortField,
    sortDir,
    page,
    pageSize,
  }), [search, manager, status, brand, client, sortField, sortDir, page]);

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
    setPage(1);
  };

  const hasFilters = search || manager || status || brand || client;

  const handleExportExcel = () => {
    toast.info("Генерація Excel файлу...");
    const link = document.createElement("a");
    link.href = "/api/export/excel";
    link.download = "orders.xlsx";
    link.click();
  };

  const tableRows = useMemo(() => {
    return rows.map((row: any) => {
      const salePrice = row.price || row.retailPrice;
      const delta = row.basePrice && salePrice
        ? (Number(salePrice) - Number(row.basePrice)).toFixed(2)
        : "";
      return {
        num: row.vortexOrderId,
        manager: row.managerName || "",
        brand: row.brandName || "",
        article: row.code || "",
        description: row.description || "",
        status: row.status || "",
        warehouse: row.whName || "",
        created: formatDate(row.createdTs),
        arrival: formatDate(row.deliveryTime),
        qty: row.qty || "",
        inputPrice: formatPrice(row.basePrice),
        inputCurrency: row.basePriceCurrency || "",
        salePrice: formatPrice(salePrice),
        delta: delta ? formatPrice(delta) : "",
        saleCurrency: row.itemCurrency || "",
        currentBalance: "",
        balanceCurrency: "",
        client: row.clientName || "",
        clientType: "",
        markupGroup: "",
        delivery: row.deliveryName || "",
        phone: row.customerPhone || "",
        issueDoc: row.trackNumber || "",
        issueDate: formatDate(row.realDeliveryTime),
        supplierBalance: "",
        supplierCurrency: "",
        invoicePaymentDate: "",
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
                  <TableHead className="w-[90px] cursor-pointer whitespace-nowrap text-right" onClick={() => handleSort("salePrice")}>
                    <div className="flex items-center justify-end gap-1">Продаж <SortIcon field="salePrice" /></div>
                  </TableHead>
                  <TableHead className="w-[80px] whitespace-nowrap text-right">Дельта</TableHead>
                  <TableHead className="w-[70px] whitespace-nowrap">Валюта продаж</TableHead>
                  <TableHead className="w-[90px] whitespace-nowrap text-right">Поточний баланс</TableHead>
                  <TableHead className="w-[70px] whitespace-nowrap">Валюта баланс</TableHead>
                  <TableHead className="w-[160px] cursor-pointer whitespace-nowrap" onClick={() => handleSort("client")}>
                    <div className="flex items-center gap-1">Клієнт <SortIcon field="client" /></div>
                  </TableHead>
                  <TableHead className="w-[90px] whitespace-nowrap">Тип клієнта</TableHead>
                  <TableHead className="w-[100px] whitespace-nowrap">Група націнок</TableHead>
                  <TableHead className="w-[140px] whitespace-nowrap">Доставка</TableHead>
                  <TableHead className="w-[120px] whitespace-nowrap">Номер телефону</TableHead>
                  <TableHead className="w-[130px] whitespace-nowrap">Документ видачі</TableHead>
                  <TableHead className="w-[100px] whitespace-nowrap">Дата видачі</TableHead>
                  <TableHead className="w-[90px] whitespace-nowrap text-right">Баланс постач.</TableHead>
                  <TableHead className="w-[70px] whitespace-nowrap">Валюта постач.</TableHead>
                  <TableHead className="w-[110px] whitespace-nowrap">Дата оплати накладної</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 27 }).map((_, j) => (
                        <TableCell key={j}>
                          <div className="h-4 bg-muted animate-pulse rounded" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : tableRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={27} className="text-center py-12 text-muted-foreground">
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
                      <TableCell className="text-xs text-right font-mono">{row.salePrice}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{row.delta}</TableCell>
                      <TableCell className="text-xs uppercase">{row.saleCurrency}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{row.currentBalance}</TableCell>
                      <TableCell className="text-xs uppercase">{row.balanceCurrency}</TableCell>
                      <TableCell className="text-xs truncate max-w-[160px]" title={row.client}>{row.client}</TableCell>
                      <TableCell className="text-xs">{row.clientType}</TableCell>
                      <TableCell className="text-xs">{row.markupGroup}</TableCell>
                      <TableCell className="text-xs truncate max-w-[140px]" title={row.delivery}>{row.delivery}</TableCell>
                      <TableCell className="text-xs font-mono">{row.phone}</TableCell>
                      <TableCell className="text-xs font-mono truncate max-w-[130px]" title={row.issueDoc}>{row.issueDoc}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{row.issueDate}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{row.supplierBalance}</TableCell>
                      <TableCell className="text-xs uppercase">{row.supplierCurrency}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{row.invoicePaymentDate}</TableCell>
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
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Сторінка {page} з {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Назад
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              Далі
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
