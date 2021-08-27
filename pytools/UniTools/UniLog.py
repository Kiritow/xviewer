# UniLog: United Logger
import logging
import sys


class UniLog(object):
    def __init__(self, name=None, filename=None, fileonly=False,
                 level=logging.INFO,
                 default_encoding='utf-8',
                 log_format="%(asctime)s @%(module)s [%(levelname)s] %(funcName)s: %(message)s"):
        if name is None:
            name = __name__

        if not filename and fileonly:
            raise Exception("FileOnly=True but no filename provided.")

        self.logger = logging.getLogger(name)
        if not getattr(self.logger, "_is_configured", None):
            formatter = logging.Formatter(log_format)
            if not fileonly:
                console_handler = logging.StreamHandler()
                console_handler.setFormatter(formatter)
                self.logger.addHandler(console_handler)
            if filename is not None:
                file_handler = logging.FileHandler(filename, encoding=default_encoding)
                file_handler.setFormatter(formatter)
                self.logger.addHandler(file_handler)
            self.logger.setLevel(level)
            setattr(self.logger, "_is_configured", True)

    # Just acts as a logger
    def __getattr__(self, name):
        return getattr(self.logger, name)


class ConsoleLog(object):
    def __init__(self, filename, stream=sys.__stdout__, level=logging.INFO, default_encoding='utf-8'):
        self.level = level
        self.stream = stream
        self.under_log = UniLog(filename=filename, fileonly=True, level=level, default_encoding=default_encoding, log_format="%(asctime)s: %(message)s")
        self.buffer = ""

    def write(self, message):
        if message.endswith("\n"):
            self.under_log.log(self.level, self.buffer + message[:-2])
            self.buffer = ""
        else:
            self.buffer += message
            # self.under_log.log(self.level, message)

        if self.stream:
            self.stream.write(message)


def redirect_stdout(filename, keep=False):
    if sys.stdout == sys.__stdout__:
        sys.stdout = ConsoleLog(filename, stream=sys.__stderr__ if keep else None)
    else:
        sys.stderr.write("[Warning] Unable to redirect stdout.\n")


def noop_func(*args, **kwargs):
    pass


class NoopLog(object):
    '''
    A No-op logger. Won't do anything.
    '''
    def __init__(self, name=None):
        self.logger = logging.getLogger(name or __name__)
        pass

    def __getattr__(self, name):
        attr = getattr(self.logger, name)
        if callable(attr):
            return noop_func
        else:
            return attr
