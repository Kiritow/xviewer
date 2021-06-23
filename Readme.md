# XViewer

The X Viewer. [MIT Licensed](LICENSE).

基于 Node.js/Koa + Vue 的本地视频文件的web浏览与播放系统，提供封面生成等功能.

## 部署

使用 `podman-compose` 或 `docker-compose` 进行本地容器部署.

```bash
podman-compose build
podman-compose pull
podman-compose up -d
```

默认web服务端口为9889，访问 [http://localhost:9889](http://localhost:9889) 即可打开主页面.

## 添加视频文件

1. 将视频文件添加到`/data/objects`(宿主机: `/mnt/faaq/objects`)文件夹下

2. 登录admin容器 `podman-compose exec admin bash`

3. 启动视频转换程序 `python generate.py`
    
    将自动扫描新增视频文件并生成封面. 重复的视频将被保留.

4. 刷新生成ES索引 `python buildes.py`

添加视频文件可以与Web服务器同时运行.

## Web API接口 (待补充)

- `/list` 获取所有视频文件信息

- `/cover?id=...` 获取封面

- `/video?id=...` 获取视频

- `/video_played` 更新视频观看数 (POST)

## 数据表设计

[xviewer.sql](design/xviewer.sql)
