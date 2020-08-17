# XViewer

The X Viewer. [MIT Licensed](LICENSE).

用Node.js+Vue+Koa写的本地视频文件的web浏览与播放系统，提供封面生成等功能.

## 配置启动

```bash
git clone https://github.com/kiritow/xviewer
cd xviewer
npm install
# 在启动之前请完成配置, 配置模板不是默认配置，不能直接拷贝使用
cp config/settings.json.example config/settings.json
vim config/settings.json
cp config/mysql_config.json.example config/mysql_config.json
vim config/mysql_config.json
npm start
```

XViewer支持**MySQL**和**SQLite3**两种数据库模式启动（目前暂不支持同时使用）。请在`config/settings.json`内设置`dbprovider`字段进行数据库backend切换。当使用MySQL作为数据库后端时，请在`config/mysql_config.json`中设置数据库连接信息。详细设置选项参见 【[XViewer配置样例](config/settings.json.example)】【[MySQL配置样例](config/mysql_config.json.example)】

默认web服务端口为9889，访问[http://localhost:9889](http://localhost:9889)即可打开主页面.

## 添加视频文件

1. 请将视频文件添加到`settings.json`中`rootdir`字段指出的文件夹下。XViewer目前暂时不支持嵌套文件夹。

2. 确保ffmpeg已安装。Windows用户请到 [ffmpeg官网](https://www.ffmpeg.org/) 下载ffmpeg静态文件并将 `ffmpeg.exe` 放置在 `bin` 文件夹下. Linux用户通过`sudo apt install ffmpeg`安装ffmpeg，并将ffmpeg链接到`bin/ffmpeg.exe`

3. 输入`node app`或`npm start`启动XViewer.

4. 等待XViewer完成对新增视频文件的扫描与封面生成.

## Web API接口

- `/list` 获取所有视频文件信息

- `/cover/...` 获取封面

- `/video/...` 获取视频

- `/video_played` 更新视频观看数 (POST)

## 数据表设计

由于XViewer仍处于开发阶段，数据表随时可能发生变动，此处数据表设计仅供参考。

### objects表

| 列名 | 数据类型 | 属性 | 描述 |
| - | - | - | - |
| id | varchar(255) | primary key | 文件ID |
| filename | varchar(255) | not null | 文件名 |
| mtime | int | | 修改时间(时间戳) |
| fsize | int | | 文件大小 |

### covers表

| 列名 | 数据类型 | 属性 | 描述 |
| - | - | - | - |
| id | varchar(255) | primary key, foreign key -> `objects.id` | 封面ID |

### videos表

| 列名 | 数据类型 | 属性 | 描述 |
| - | - | - | - |
| id | varchar(255) | primary key, foreign key -> `objects.id` | 视频ID |
| coverid | varchar(255) | foreign key -> `covers.id` | 封面ID |
| watchcount | int | | 观看次数 |
| uploader | varchar(255) | | 上传者 | 
| tags | varchar(255) | | 标签 |
