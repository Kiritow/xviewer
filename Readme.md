# XViewer

The X Viewer. [MIT Licensed](LICENSE).

基于 Node.js/Koa + Vue 的本地视频文件的web浏览与播放系统，提供封面生成等功能.

## 部署

推荐使用 [`docker-compose`](https://docs.docker.com/compose/) 进行本地容器部署.

```bash
docker-compose pull && docker-compose build && docker-compose up -d
```

*第一次启动时需要手动初始化数据库表.*

默认web服务端口为9889，访问 [http://localhost:9889](http://localhost:9889) 即可打开主页面.

## 添加视频文件

1. 将视频文件添加到`/data/pending`(宿主机: `/mnt/faaq/pending`)文件夹下

2. 登录admin容器 `docker-compose exec admin bash`

3. 启动视频转换程序 `python generate.py`
    
    将自动扫描新增视频文件并生成封面. 重复的视频将被保留.

4. 刷新生成ES索引 `python buildes.py`

可以在提供Web服务的同时添加视频文件.

## 基础API接口

| Method | API Path | 含义 |
| -- | -- | -- |
| GET | /api/list | 视频列表 |
| GET | /api/search | 关键词搜索 |
| GET | /api/recommend | 推荐视频列表 |
| POST | /api/preferred | 个性化视频列表 |
| POST | /api/video_played | 视频播放上报 |
| POST | /api/video_playing | 视频播放时长上报 |
| POST | /api/add_tag | 添加tag |
| POST | /api/remove_tag | 删除tag |
| POST | /api/add_fav | 添加收藏夹 |
| POST | /api/remove_fav | 从收藏夹移除 |
| POST | /api/favorites | 收藏夹列表 |
| POST | /api/history | 播放历史 |
| POST | /api/login | 登录 |
| POST | /api/register | 注册 |


## 数据表设计

[xviewer.sql](design/xviewer.sql)
