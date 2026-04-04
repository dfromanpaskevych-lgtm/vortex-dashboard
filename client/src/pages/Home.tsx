import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from "recharts";
import { ShoppingCart, DollarSign, Users, Package, TrendingUp, Layers } from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  waiting: "Очікування",
  pending: "В обробці",
  expected: "Очікується",
  in_stock: "На складі",
  complete: "Виконано",
  canceled: "Скасовано",
  returned: "Повернуто",
  archived: "Архів",
};

const PIE_COLORS = [
  "oklch(0.65 0.2 250)",
  "oklch(0.7 0.18 150)",
  "oklch(0.75 0.15 50)",
  "oklch(0.6 0.22 30)",
  "oklch(0.65 0.15 300)",
  "oklch(0.7 0.12 200)",
  "oklch(0.55 0.2 350)",
  "oklch(0.8 0.1 100)",
];

function formatNumber(n: number | string | null | undefined): string {
  if (n == null) return "0";
  const num = Number(n);
  if (isNaN(num)) return "0";
  return num.toLocaleString("uk-UA", { maximumFractionDigits: 0 });
}

function formatCurrency(n: number | string | null | undefined): string {
  if (n == null) return "0.00";
  const num = Number(n);
  if (isNaN(num)) return "0.00";
  return num.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortenName(name: string, maxLen = 25): string {
  if (!name) return "";
  if (name.length <= maxLen) return name;
  // Try to find first meaningful part
  const parts = name.split(/[\s(]/);
  let short = parts[0] || "";
  if (parts.length > 1 && (short.length + parts[1].length) < maxLen) {
    short += " " + parts[1];
  }
  return short.length > maxLen ? short.slice(0, maxLen) + "..." : short;
}

export default function Home() {
  const { data: metrics, isLoading } = trpc.dashboard.metrics.useQuery();

  if (isLoading || !metrics) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Дашборд</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <div className="h-20 bg-muted animate-pulse rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const { totals, byManager, byStatus, byDay, byBrand } = metrics;

  // Prepare chart data
  const statusData = (byStatus || []).map((s: any) => ({
    name: STATUS_LABELS[s.status] || s.status,
    value: Number(s.count),
  }));

  const managerData = (byManager || []).slice(0, 10).map((m: any) => ({
    name: shortenName(m.manager || ""),
    fullName: m.manager || "",
    orders: Number(m.orderCount),
    sum: Number(m.sumUah),
  }));

  const dailyData = (byDay || []).map((d: any) => ({
    date: d.day ? String(d.day).slice(5) : "",
    orders: Number(d.orderCount),
    sum: Number(d.sumUah),
  }));

  const brandData = (byBrand || []).map((b: any) => ({
    name: b.brand || "",
    count: Number(b.count),
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Дашборд</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                <ShoppingCart className="h-6 w-6 text-blue-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Замовлень</p>
                <p className="text-2xl font-bold text-foreground">{formatNumber(totals?.totalOrders)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-green-500/10 flex items-center justify-center shrink-0">
                <DollarSign className="h-6 w-6 text-green-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Сума (UAH)</p>
                <p className="text-2xl font-bold text-foreground">{formatCurrency(totals?.totalSumUah)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-purple-500/10 flex items-center justify-center shrink-0">
                <Package className="h-6 w-6 text-purple-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Позицій</p>
                <p className="text-2xl font-bold text-foreground">{formatNumber(totals?.totalItems)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-orange-500/10 flex items-center justify-center shrink-0">
                <Layers className="h-6 w-6 text-orange-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Кількість</p>
                <p className="text-2xl font-bold text-foreground">{formatNumber(totals?.totalQty)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Daily dynamics */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Динаміка по днях
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dailyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "oklch(0.21 0.006 285.885)",
                      border: "1px solid oklch(1 0 0 / 10%)",
                      borderRadius: "8px",
                      color: "oklch(0.85 0.005 65)",
                    }}
                  />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="orders" stroke="oklch(0.65 0.2 250)" name="Замовлень" strokeWidth={2} dot={{ r: 3 }} />
                  <Line yAxisId="right" type="monotone" dataKey="sum" stroke="oklch(0.7 0.18 150)" name="Сума (UAH)" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
                Немає даних
              </div>
            )}
          </CardContent>
        </Card>

        {/* Status distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Розподіл по статусах</CardTitle>
          </CardHeader>
          <CardContent>
            {statusData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {statusData.map((_: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "oklch(0.21 0.006 285.885)",
                      border: "1px solid oklch(1 0 0 / 10%)",
                      borderRadius: "8px",
                      color: "oklch(0.85 0.005 65)",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
                Немає даних
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* By Manager */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Топ менеджерів
            </CardTitle>
          </CardHeader>
          <CardContent>
            {managerData.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={managerData} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "oklch(0.21 0.006 285.885)",
                      border: "1px solid oklch(1 0 0 / 10%)",
                      borderRadius: "8px",
                      color: "oklch(0.85 0.005 65)",
                    }}
                    formatter={(value: any, name: string) => [
                      name === "orders" ? formatNumber(value) : formatCurrency(value),
                      name === "orders" ? "Замовлень" : "Сума (UAH)",
                    ]}
                  />
                  <Bar dataKey="orders" fill="oklch(0.65 0.2 250)" radius={[0, 4, 4, 0]} name="Замовлень" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[320px] flex items-center justify-center text-muted-foreground text-sm">
                Немає даних
              </div>
            )}
          </CardContent>
        </Card>

        {/* By Brand */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Топ брендів</CardTitle>
          </CardHeader>
          <CardContent>
            {brandData.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={brandData} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "oklch(0.21 0.006 285.885)",
                      border: "1px solid oklch(1 0 0 / 10%)",
                      borderRadius: "8px",
                      color: "oklch(0.85 0.005 65)",
                    }}
                  />
                  <Bar dataKey="count" fill="oklch(0.7 0.18 150)" radius={[0, 4, 4, 0]} name="Позицій" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[320px] flex items-center justify-center text-muted-foreground text-sm">
                Немає даних
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
