FROM alpine:3.20

# minio e minio-client estão nos repositórios oficiais do Alpine.
# O cliente instala-se como "mcli" para não colidir com o Midnight Commander;
# o symlink mc→mcli mantém os scripts existentes a funcionar.
RUN apk add --no-cache minio minio-client curl && \
    ln -s /usr/bin/mcli /usr/local/bin/mc

EXPOSE 9000 9001

ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001"]
