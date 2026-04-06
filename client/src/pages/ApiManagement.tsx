import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Key, Webhook, Plus, Trash2, Copy, Eye, EyeOff, Ban, CheckCircle2, AlertTriangle, ExternalLink } from "lucide-react";

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = new Date(date);
  return d.toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ============ API KEYS SECTION ============

function ApiKeysSection() {
  const [newKeyName, setNewKeyName] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  const utils = trpc.useUtils();
  const { data: keys = [], isLoading } = trpc.apiKeys.list.useQuery();

  const createMutation = trpc.apiKeys.create.useMutation({
    onSuccess: (result) => {
      setCreatedKey(result.rawKey);
      setNewKeyName("");
      utils.apiKeys.list.invalidate();
      toast.success("API ключ створено");
    },
    onError: (err) => {
      toast.error("Помилка створення ключа: " + err.message);
    },
  });

  const revokeMutation = trpc.apiKeys.revoke.useMutation({
    onSuccess: () => {
      utils.apiKeys.list.invalidate();
      toast.success("API ключ деактивовано");
    },
  });

  const deleteMutation = trpc.apiKeys.delete.useMutation({
    onSuccess: () => {
      utils.apiKeys.list.invalidate();
      toast.success("API ключ видалено");
    },
  });

  const handleCreate = () => {
    if (!newKeyName.trim()) {
      toast.error("Вкажіть назву ключа");
      return;
    }
    createMutation.mutate({ name: newKeyName.trim() });
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Скопійовано в буфер обміну");
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              API Ключі
            </CardTitle>
            <CardDescription className="mt-1">
              Ключі для доступу до REST API. Використовуйте заголовок: Authorization: Bearer &lt;ключ&gt;
            </CardDescription>
          </div>
          <Dialog open={showDialog} onOpenChange={(open) => {
            setShowDialog(open);
            if (!open) {
              setCreatedKey(null);
              setShowKey(false);
            }
          }}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Створити ключ
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Створити новий API ключ</DialogTitle>
                <DialogDescription>
                  Ключ буде показано лише один раз. Збережіть його в безпечному місці.
                </DialogDescription>
              </DialogHeader>

              {!createdKey ? (
                <>
                  <div className="space-y-2">
                    <Label>Назва ключа</Label>
                    <Input
                      placeholder="Наприклад: Зовнішній додаток"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                    />
                  </div>
                  <DialogFooter>
                    <Button onClick={handleCreate} disabled={createMutation.isPending}>
                      {createMutation.isPending ? "Створення..." : "Створити"}
                    </Button>
                  </DialogFooter>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-lg bg-green-500/10 border border-green-500/30 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <span className="text-sm font-medium text-green-500">Ключ створено!</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs bg-background/50 p-2 rounded font-mono break-all">
                        {showKey ? createdKey : createdKey.slice(0, 10) + "•".repeat(40)}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setShowKey(!showKey)}
                      >
                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleCopy(createdKey)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/30 p-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-yellow-500" />
                      <span className="text-sm text-yellow-500">
                        Цей ключ більше не буде показано. Скопіюйте його зараз!
                      </span>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => {
                      setShowDialog(false);
                      setCreatedKey(null);
                      setShowKey(false);
                    }}>
                      Закрити
                    </Button>
                  </DialogFooter>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Завантаження...</div>
        ) : keys.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Немає API ключів. Створіть перший ключ для доступу до REST API.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Назва</TableHead>
                <TableHead>Префікс</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Останнє використання</TableHead>
                <TableHead>Створено</TableHead>
                <TableHead className="text-right">Дії</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell className="font-medium">{key.name}</TableCell>
                  <TableCell>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{key.keyPrefix}...</code>
                  </TableCell>
                  <TableCell>
                    {key.active ? (
                      <Badge variant="default" className="bg-green-600">Активний</Badge>
                    ) : (
                      <Badge variant="secondary">Деактивований</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDate(key.lastUsedAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDate(key.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {key.active && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => revokeMutation.mutate({ id: key.id })}
                          title="Деактивувати"
                        >
                          <Ban className="h-4 w-4 text-yellow-500" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm("Видалити цей API ключ назавжди?")) {
                            deleteMutation.mutate({ id: key.id });
                          }
                        }}
                        title="Видалити"
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ============ WEBHOOKS SECTION ============

const EVENT_LABELS: Record<string, string> = {
  "order.created": "Нове замовлення",
  "order.updated": "Зміна замовлення",
  "order.deleted": "Видалення замовлення",
  "item.status_changed": "Зміна статусу позиції",
  "item.price_changed": "Зміна ціни позиції",
  "sync.completed": "Синхронізація завершена",
};

function WebhooksSection() {
  const [showDialog, setShowDialog] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const { data: webhooksList = [], isLoading } = trpc.webhooks.list.useQuery();
  const { data: availableEvents = [] } = trpc.webhooks.availableEvents.useQuery();

  const createMutation = trpc.webhooks.create.useMutation({
    onSuccess: (result) => {
      setCreatedSecret(result.secret);
      utils.webhooks.list.invalidate();
      toast.success("Webhook створено");
    },
    onError: (err) => {
      toast.error("Помилка створення webhook: " + err.message);
    },
  });

  const updateMutation = trpc.webhooks.update.useMutation({
    onSuccess: () => {
      utils.webhooks.list.invalidate();
      toast.success("Webhook оновлено");
    },
  });

  const deleteMutation = trpc.webhooks.delete.useMutation({
    onSuccess: () => {
      utils.webhooks.list.invalidate();
      toast.success("Webhook видалено");
    },
  });

  const handleCreate = () => {
    if (!newUrl.trim()) {
      toast.error("Вкажіть URL");
      return;
    }
    if (selectedEvents.length === 0) {
      toast.error("Оберіть хоча б одну подію");
      return;
    }
    createMutation.mutate({ url: newUrl.trim(), events: selectedEvents });
  };

  const toggleEvent = (event: string) => {
    setSelectedEvents((prev) =>
      prev.includes(event)
        ? prev.filter((e) => e !== event)
        : [...prev, event]
    );
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Скопійовано в буфер обміну");
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Webhook className="h-5 w-5" />
              Webhooks
            </CardTitle>
            <CardDescription className="mt-1">
              Отримуйте HTTP POST повідомлення при зміні даних під час синхронізації.
              Payload підписується HMAC-SHA256.
            </CardDescription>
          </div>
          <Dialog open={showDialog} onOpenChange={(open) => {
            setShowDialog(open);
            if (!open) {
              setCreatedSecret(null);
              setNewUrl("");
              setSelectedEvents([]);
            }
          }}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Додати webhook
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Додати новий Webhook</DialogTitle>
                <DialogDescription>
                  Вкажіть URL та оберіть події, на які потрібно підписатися.
                </DialogDescription>
              </DialogHeader>

              {!createdSecret ? (
                <>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>URL ендпоінту</Label>
                      <Input
                        placeholder="https://your-app.com/webhook"
                        value={newUrl}
                        onChange={(e) => setNewUrl(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Події</Label>
                      <div className="grid grid-cols-1 gap-2">
                        {availableEvents.map((event) => (
                          <label
                            key={event}
                            className={`flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors ${
                              selectedEvents.includes(event)
                                ? "border-primary bg-primary/5"
                                : "border-border hover:border-muted-foreground/30"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedEvents.includes(event)}
                              onChange={() => toggleEvent(event)}
                              className="rounded"
                            />
                            <div>
                              <div className="text-sm font-medium">{EVENT_LABELS[event] || event}</div>
                              <div className="text-xs text-muted-foreground">{event}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={handleCreate} disabled={createMutation.isPending}>
                      {createMutation.isPending ? "Створення..." : "Створити"}
                    </Button>
                  </DialogFooter>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-lg bg-green-500/10 border border-green-500/30 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <span className="text-sm font-medium text-green-500">Webhook створено!</span>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Signing Secret (для перевірки підпису):</Label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs bg-background/50 p-2 rounded font-mono break-all">
                          {createdSecret}
                        </code>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleCopy(createdSecret)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/30 p-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-yellow-500" />
                      <span className="text-sm text-yellow-500">
                        Збережіть signing secret! Він більше не буде показаний повністю.
                      </span>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => {
                      setShowDialog(false);
                      setCreatedSecret(null);
                      setNewUrl("");
                      setSelectedEvents([]);
                    }}>
                      Закрити
                    </Button>
                  </DialogFooter>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Завантаження...</div>
        ) : webhooksList.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Немає webhooks. Додайте webhook для отримання повідомлень про зміни даних.
          </div>
        ) : (
          <div className="space-y-4">
            {webhooksList.map((wh) => (
              <div
                key={wh.id}
                className="border rounded-lg p-4 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
                      <code className="text-sm font-mono truncate">{wh.url}</code>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Secret: <code>{wh.secret}</code></span>
                      <span>|</span>
                      <span>Створено: {formatDate(wh.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => updateMutation.mutate({ id: wh.id, active: !wh.active })}
                    >
                      {wh.active ? (
                        <Badge variant="default" className="bg-green-600">Активний</Badge>
                      ) : (
                        <Badge variant="secondary">Вимкнено</Badge>
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        if (confirm("Видалити цей webhook?")) {
                          deleteMutation.mutate({ id: wh.id });
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {((wh.events as string[]) || []).map((event) => (
                    <Badge key={event} variant="outline" className="text-xs">
                      {EVENT_LABELS[event] || event}
                    </Badge>
                  ))}
                </div>

                {wh.lastDeliveredAt && (
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>Остання доставка: {formatDate(wh.lastDeliveredAt)}</span>
                    {wh.lastStatus && (
                      <span className={wh.lastStatus >= 200 && wh.lastStatus < 300 ? "text-green-500" : "text-red-500"}>
                        HTTP {wh.lastStatus}
                      </span>
                    )}
                    {(wh.failCount ?? 0) > 0 && (
                      <span className="text-red-500">
                        Помилок: {wh.failCount}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============ API DOCUMENTATION SECTION ============

function ApiDocsSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Документація REST API</CardTitle>
        <CardDescription>
          Базовий URL: <code className="bg-muted px-1.5 py-0.5 rounded">/api/v1</code>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <h4 className="font-medium text-sm">Автентифікація</h4>
          <div className="bg-muted/50 rounded-lg p-3">
            <code className="text-sm">Authorization: Bearer vx_your_api_key_here</code>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="font-medium text-sm">Ендпоінти</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Метод</TableHead>
                <TableHead>Шлях</TableHead>
                <TableHead>Опис</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell><Badge>GET</Badge></TableCell>
                <TableCell><code className="text-xs">/api/v1/orders</code></TableCell>
                <TableCell>Список замовлень з фільтрами та пагінацією</TableCell>
              </TableRow>
              <TableRow>
                <TableCell><Badge>GET</Badge></TableCell>
                <TableCell><code className="text-xs">/api/v1/orders/:id</code></TableCell>
                <TableCell>Деталі замовлення з позиціями та історією змін</TableCell>
              </TableRow>
              <TableRow>
                <TableCell><Badge>GET</Badge></TableCell>
                <TableCell><code className="text-xs">/api/v1/logistics</code></TableCell>
                <TableCell>Записи логістики (ВЛАСНА ЛОГІСТИКА)</TableCell>
              </TableRow>
              <TableRow>
                <TableCell><Badge>GET</Badge></TableCell>
                <TableCell><code className="text-xs">/api/v1/changes</code></TableCell>
                <TableCell>Історія змін з фільтрами</TableCell>
              </TableRow>
              <TableRow>
                <TableCell><Badge>GET</Badge></TableCell>
                <TableCell><code className="text-xs">/api/v1/sync/status</code></TableCell>
                <TableCell>Статус синхронізації (останні 10 логів)</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <div className="space-y-3">
          <h4 className="font-medium text-sm">Параметри фільтрації (GET /api/v1/orders)</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Параметр</TableHead>
                <TableHead>Тип</TableHead>
                <TableHead>Опис</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                ["page", "number", "Номер сторінки (за замовч. 1)"],
                ["pageSize", "number", "Розмір сторінки (1-500, за замовч. 100)"],
                ["manager", "string", "Фільтр по менеджеру (часткове співпадіння)"],
                ["client", "string", "Фільтр по клієнту (часткове співпадіння)"],
                ["status", "string", "Фільтр по статусу позиції (точне)"],
                ["brand", "string", "Фільтр по бренду (часткове)"],
                ["search", "string", "Пошук по всіх полях"],
                ["dateFrom", "number", "Дата від (Unix timestamp, секунди)"],
                ["dateTo", "number", "Дата до (Unix timestamp, секунди)"],
              ].map(([param, type, desc]) => (
                <TableRow key={param}>
                  <TableCell><code className="text-xs">{param}</code></TableCell>
                  <TableCell className="text-muted-foreground text-xs">{type}</TableCell>
                  <TableCell className="text-sm">{desc}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="space-y-3">
          <h4 className="font-medium text-sm">Webhook Events</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Подія</TableHead>
                <TableHead>Опис</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(EVENT_LABELS).map(([event, label]) => (
                <TableRow key={event}>
                  <TableCell><code className="text-xs">{event}</code></TableCell>
                  <TableCell className="text-sm">{label}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="space-y-3">
          <h4 className="font-medium text-sm">Webhook Payload</h4>
          <div className="bg-muted/50 rounded-lg p-3">
            <pre className="text-xs font-mono whitespace-pre-wrap">{`{
  "event": "order.updated",
  "timestamp": "2026-04-06T12:00:00.000Z",
  "data": {
    "vortexOrderId": "87749",
    "changes": [
      { "field": "item_status [CODE]", "oldVal": "pending", "newVal": "complete" },
      { "field": "item_price [CODE]", "oldVal": "1000", "newVal": "1200" }
    ],
    "syncBatchId": "abc123"
  }
}`}</pre>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="font-medium text-sm">Webhook Headers</h4>
          <div className="bg-muted/50 rounded-lg p-3 space-y-1">
            <div className="text-xs font-mono">X-Webhook-Signature: &lt;HMAC-SHA256 hex digest&gt;</div>
            <div className="text-xs font-mono">X-Webhook-Event: order.updated</div>
            <div className="text-xs font-mono">X-Webhook-Timestamp: 2026-04-06T12:00:00.000Z</div>
            <div className="text-xs font-mono">Content-Type: application/json</div>
          </div>
          <p className="text-xs text-muted-foreground">
            Для перевірки підпису: обчисліть HMAC-SHA256 від тіла запиту з вашим signing secret
            і порівняйте з заголовком X-Webhook-Signature.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ============ MAIN PAGE ============

export default function ApiManagement() {
  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">API & Webhooks</h1>
        <p className="text-muted-foreground mt-1">
          Управління зовнішнім доступом до даних та push-повідомленнями про зміни
        </p>
      </div>

      <ApiKeysSection />
      <WebhooksSection />
      <ApiDocsSection />
    </div>
  );
}
