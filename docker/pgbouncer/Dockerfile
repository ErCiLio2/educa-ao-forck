FROM alpine:3.21

RUN apk add --no-cache pgbouncer shadow \
    && groupadd -r pgbouncer \
    && useradd -r -g pgbouncer pgbouncer \
    && mkdir -p /etc/pgbouncer /var/log/pgbouncer /var/run/pgbouncer \
    && chown -R pgbouncer:pgbouncer /var/log/pgbouncer /var/run/pgbouncer

COPY --chown=pgbouncer:pgbouncer pgbouncer.ini /etc/pgbouncer/pgbouncer.ini
COPY --chown=pgbouncer:pgbouncer userlist.txt  /etc/pgbouncer/userlist.txt

RUN chmod 640 /etc/pgbouncer/userlist.txt

EXPOSE 5432

USER pgbouncer
CMD ["pgbouncer", "/etc/pgbouncer/pgbouncer.ini"]
