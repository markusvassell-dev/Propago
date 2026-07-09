{ pkgs }: {
  deps = [
    pkgs.redis # BullMQ backend — replit-start.sh runs redis-server on 127.0.0.1:6379
  ];
}
