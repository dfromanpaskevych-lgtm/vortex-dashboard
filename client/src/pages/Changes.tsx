import { trpc } from "@/lib/trpc";
import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowRight, Plus, Pencil, Trash2 } from "lucide-react";

const CHANGE_TYPE_MAP: Record<string, { label: string; icon: any; color: string }> = {
  new: { label: "Нове", icon: Plus, color: "text-green-500" },
  modified: { label: "Змінено", icon: Pencil, color: "text-yellow-500" },
  deleted: { label: "Видалено", icon: Trash2, color: "text-red-500" },
};

const FIELD_LABELS: Record<string, string> = {
  clientName: "Клієнт",
  managerName: "Менеджер",
  sumUah: "Сума (UAH)",
  customerPhone: "Телефон",
  trackNumber: "Трек-номер",
  deliveryName: "Доставка",
  items_count: "Кількість позицій",
  order: "Замовлення",
};

function formatFieldLabel(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  if (field.startsWith("item_status_")) return `Статус: ${field.replace("item_status_", "")}`;
  return field;
}

export default function Changes() {
  const [changeType, setChangeType] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const queryInput = useMemo(() => ({
    page,
    pageSize,
    changeType: changeType || undefined,
  }), [page, pageSize, changeType]);

  const { data, isLoading } = trpc.changes.list.useQuery(queryInput);

  const rows = data?.rows || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Історія змін</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Всього: {total} записів
          </p>
        </div>
        <Select value={changeType} onValueChange={(v) => { setChangeType(v); setPage(1); }}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Тип змін" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Всі зміни</SelectItem>
            <SelectItem value="new">Нові</SelectItem>
            <SelectItem value="modified">Змінені</SelectItem>
            <SelectItem value="deleted">Видалені</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                <Plus className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Нові замовлення</p>
                <p className="text-xl font-bold text-foreground">
                  {rows.filter((r: any) => r.changeType === "new").length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                <Pencil className="h-5 w-5 text-yellow-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Змінені</p>
                <p className="text-xl font-bold text-foreground">
                  {rows.filter((r: any) => r.changeType === "modified").length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-red-500/10 flex items-center justify-center">
                <Trash2 className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Видалені</p>
                <p className="text-xl font-bold text-foreground">
                  {rows.filter((r: any) => r.changeType === "deleted").length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Changes table */}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-[100px]">Тип</TableHead>
              <TableHead className="w-[100px]">Замовлення</TableHead>
              <TableHead className="w-[150px]">Поле</TableHead>
              <TableHead>Стара значення</TableHead>
              <TableHead className="w-[30px]"></TableHead>
              <TableHead>Нова значення</TableHead>
              <TableHead className="w-[160px]">Дата</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j}>
                      <div className="h-4 bg-muted animate-pulse rounded" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                  Змін не знайдено. Запустіть синхронізацію для відстеження змін.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row: any) => {
                const typeInfo = CHANGE_TYPE_MAP[row.changeType] || CHANGE_TYPE_MAP.modified;
                const Icon = typeInfo.icon;
                return (
                  <TableRow key={row.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell>
                      <Badge
                        variant={row.changeType === "new" ? "default" : row.changeType === "deleted" ? "destructive" : "secondary"}
                        className="text-[10px]"
                      >
                        <Icon className="h-3 w-3 mr-1" />
                        {typeInfo.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">#{row.vortexOrderId}</TableCell>
                    <TableCell className="text-xs">{formatFieldLabel(row.fieldName || "")}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={row.oldValue || ""}>
                      {row.oldValue || "-"}
                    </TableCell>
                    <TableCell>
                      {row.changeType === "modified" && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
                    </TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate" title={row.newValue || ""}>
                      {row.newValue || "-"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {row.createdAt ? new Date(row.createdAt).toLocaleString("uk-UA") : ""}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
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
