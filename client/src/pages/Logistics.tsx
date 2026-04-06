import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, Truck, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  complete: "bg-green-500/20 text-green-400 border-green-500/30",
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  processing: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  cancelled: "bg-red-500/20 text-red-400 border-red-500/30",
};

export default function Logistics() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const queryInput = useMemo(() => ({
    search: search || undefined,
    page,
    pageSize,
  }), [search, page, pageSize]);

  const { data, isLoading } = trpc.logistics.list.useQuery(queryInput);

  const rows = data?.rows || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize);

  const formatDate = (ts: number | null) => {
    if (!ts) return "—";
    return new Date(ts * 1000).toLocaleDateString("uk-UA", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  const formatMoney = (val: string | null, currency?: string) => {
    if (!val) return "—";
    const num = parseFloat(val);
    if (isNaN(num)) return val;
    const formatted = num.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return currency ? `${formatted} ${currency}` : formatted;
  };

  // Pagination helpers
  const startRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endRow = Math.min(page * pageSize, total);

  const getPageNumbers = () => {
    const pages: (number | "...")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push("...");
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
        pages.push(i);
      }
      if (page < totalPages - 2) pages.push("...");
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Truck className="h-6 w-6 text-orange-400" />
        <h1 className="text-2xl font-bold">Логістика</h1>
        <Badge variant="outline" className="ml-2 text-sm">
          {total} записів
        </Badge>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex gap-3 items-center">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Пошук по клієнту, накладній, ТТН..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="pl-10"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Накладна</TableHead>
                  <TableHead>Дата</TableHead>
                  <TableHead>Клієнт</TableHead>
                  <TableHead>Менеджер</TableHead>
                  <TableHead>Опис</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">К-сть</TableHead>
                  <TableHead className="text-right">Ціна</TableHead>
                  <TableHead className="text-right">Валюта</TableHead>
                  <TableHead>ТТН</TableHead>
                  <TableHead>Доставка</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                      Завантаження...
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                      Записів логістики не знайдено
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row: any, idx: number) => (
                    <TableRow key={`${row.vortexOrderId}-${row.itemId}-${idx}`}>
                      <TableCell className="font-mono text-xs">{row.vortexOrderId}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{formatDate(row.createdTs)}</TableCell>
                      <TableCell className="max-w-[180px] truncate text-sm">{row.clientName || "—"}</TableCell>
                      <TableCell className="max-w-[150px] truncate text-sm">{row.managerName || "—"}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm">{row.description || "—"}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-xs ${STATUS_COLORS[row.status] || "bg-gray-500/20 text-gray-400 border-gray-500/30"}`}
                        >
                          {row.status || "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm">{row.qty ?? "—"}</TableCell>
                      <TableCell className="text-right text-sm font-mono">
                        {formatMoney(row.price)}
                      </TableCell>
                      <TableCell className="text-right text-xs">{row.itemCurrency || row.currency || "—"}</TableCell>
                      <TableCell className="font-mono text-xs max-w-[140px] truncate">{row.trackNumber || "—"}</TableCell>
                      <TableCell className="text-xs max-w-[140px] truncate">{row.deliveryName || "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {total > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <div className="text-sm text-muted-foreground">
                {startRow}–{endRow} з {total}
              </div>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(1)}>
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {getPageNumbers().map((p, i) =>
                  p === "..." ? (
                    <span key={`dots-${i}`} className="px-2 text-muted-foreground">…</span>
                  ) : (
                    <Button
                      key={p}
                      variant={p === page ? "default" : "outline"}
                      size="icon"
                      className="h-8 w-8 text-xs"
                      onClick={() => setPage(p as number)}
                    >
                      {p}
                    </Button>
                  )
                )}
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Рядків:</span>
                <select
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                  className="bg-background border border-border rounded px-2 py-1 text-sm"
                >
                  {[25, 50, 100, 200].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
