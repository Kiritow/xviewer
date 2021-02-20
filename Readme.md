# XViewer

The X Viewer. [MIT Licensed](LICENSE).

用Node.js+Vue+Koa写的本地视频文件的web浏览与播放系统，提供封面生成等功能.

## 部署

### 本地部署

```bash
git clone https://github.com/kiritow/xviewer
cd xviewer
npm install
# 在启动之前请完成配置, 配置模板不能直接使用.
cp config/settings.json.example config/settings.json
vim config/settings.json
cp config/mysql_config.json.example config/mysql_config.json
vim config/mysql_config.json
npm start
```

XViewer支持**MySQL**和**SQLite3**两种数据库模式启动（目前暂不支持同时使用）。请在`config/settings.json`内设置`dbprovider`字段进行数据库backend切换。当使用MySQL作为数据库后端时，请在`config/mysql_config.json`中设置数据库连接信息。详细设置选项参见 【[XViewer配置样例](config/settings.json.example)】【[MySQL配置样例](config/mysql_config.json.example)】

默认web服务端口为9889，访问[http://localhost:9889](http://localhost:9889)即可打开主页面.

### Docker部署

```bash
git clone https://github.com/kiritow/xviewer
cd xviewer
podman build . -t xviewer:latest

# 在构建时请提前写入配置, 配置模板不能直接使用.
podman run -d -p 9889:9889 xviewer:latest

# 或通过挂载config路径到容器/app/config覆盖配置
sudo podman run -d -p 9889:9889 -v config:/app/config xviewer:latest
```

## 添加视频文件

1. 将视频文件添加到`settings.json`配置的`${rootdir}/objects`文件夹下

2. 安装依赖 `sudo apt install ffmpeg python python-pip`

3. 安装pip依赖 `pip install mysql-python`

    若安装失败请尝试 `sudo apt install libmariadbclient-dev` 后再安装.

4. 启动转换程序 `python generate.py`
    
    将自动扫描新增视频文件并生成封面. 重复的视频将被保留.

添加视频文件可以与Web服务器同时运行.

## Web API接口

- `/list` 获取所有视频文件信息

- `/cover?id=...` 获取封面

- `/video?id=...` 获取视频

- `/video_played` 更新视频观看数 (POST)

## 数据表设计

[xviewer.sql](design/xviewer.sql)
