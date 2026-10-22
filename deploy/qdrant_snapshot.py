"""Qdrant 컬렉션 스냅샷을 표준 입출력으로 주고받는다. backup.sh·restore.sh 가 backend 컨테이너 안에서 돌린다.

qdrant 이미지에는 curl 이 없고 포트도 밖으로 열지 않으므로, 같은 내부망에 있는 backend 의 httpx 를 쓴다.
  list            컬렉션 이름을 한 줄에 하나씩
  dump <name>     스냅샷을 만들어 stdout 으로 내보내고 서버 쪽 사본은 지운다
  load <name>     stdin 의 스냅샷으로 컬렉션을 덮어쓴다
"""

import shutil
import sys
import tempfile

import httpx

BASE = "http://qdrant:6333"


def main() -> None:
    cmd = sys.argv[1]
    with httpx.Client(base_url=BASE, timeout=600) as client:
        if cmd == "list":
            resp = client.get("/collections")
            resp.raise_for_status()
            for col in resp.json()["result"]["collections"]:
                print(col["name"])
        elif cmd == "dump":
            name = sys.argv[2]
            resp = client.post(f"/collections/{name}/snapshots", params={"wait": "true"})
            resp.raise_for_status()
            snap = resp.json()["result"]["name"]
            try:
                with client.stream("GET", f"/collections/{name}/snapshots/{snap}") as dl:
                    dl.raise_for_status()
                    for chunk in dl.iter_bytes():
                        sys.stdout.buffer.write(chunk)
            finally:
                client.delete(f"/collections/{name}/snapshots/{snap}")
        elif cmd == "load":
            name = sys.argv[2]
            # 파이프는 길이를 알 수 없어 multipart Content-Length 가 어긋난다. 파일로 받아 올린다.
            with tempfile.TemporaryFile() as spool:
                shutil.copyfileobj(sys.stdin.buffer, spool)
                spool.seek(0)
                resp = client.post(
                    f"/collections/{name}/snapshots/upload",
                    params={"priority": "snapshot", "wait": "true"},
                    files={"snapshot": (f"{name}.snapshot", spool)},
                )
            resp.raise_for_status()
            print(f"restored {name}", file=sys.stderr)
        else:
            sys.exit(f"unknown command: {cmd}")


if __name__ == "__main__":
    main()
