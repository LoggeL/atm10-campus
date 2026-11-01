"""Small SNBT reader/writer for RCON block data, preserving numeric NBT types."""
import json
import re


class Number:
    def __init__(self, raw):
        self.raw = raw
        self.value = float(re.sub(r'[bBsSlLfFdD]$', '', raw))

    def __int__(self):
        return int(self.value)


class Array(list):
    def __init__(self, kind, values):
        super().__init__(values)
        self.kind = kind


def loads(text):
    if len(text) > 262144:
        raise ValueError('SNBT too large')
    pos = 0

    def space():
        nonlocal pos
        while pos < len(text) and text[pos].isspace():
            pos += 1

    def quoted():
        nonlocal pos
        quote = text[pos]
        pos += 1
        out = ''
        while pos < len(text):
            ch = text[pos]
            pos += 1
            if ch == quote:
                return out
            if ch == '\\':
                if pos == len(text) or text[pos] not in (quote, '\\'):
                    raise ValueError('Invalid SNBT escape')
                ch = text[pos]
                pos += 1
            out += ch
        raise ValueError('Unclosed SNBT string')

    def token(key=False):
        nonlocal pos
        space()
        if pos < len(text) and text[pos] in ('"', "'"):
            return quoted()
        start = pos
        while pos < len(text) and not text[pos].isspace() and text[pos] not in (':,{}[]' if key else ',{}[]'):
            pos += 1
        if start == pos:
            raise ValueError('Missing SNBT token')
        return text[start:pos]

    def take(ch):
        nonlocal pos
        space()
        if pos >= len(text) or text[pos] != ch:
            raise ValueError('Expected ' + ch)
        pos += 1

    def value(depth=0):
        nonlocal pos
        if depth > 40:
            raise ValueError('SNBT too deeply nested')
        space()
        if pos >= len(text):
            raise ValueError('Incomplete SNBT')
        ch = text[pos]
        if ch == '{':
            pos += 1
            out = {}
            space()
            while text[pos] != '}':
                key = token(True)
                if key in out:
                    raise ValueError('Duplicate SNBT key')
                take(':')
                out[key] = value(depth + 1)
                space()
                if text[pos] == '}':
                    break
                take(',')
            pos += 1
            return out
        if ch == '[':
            pos += 1
            space()
            kind = None
            if pos + 1 < len(text) and text[pos] in 'BIL' and text[pos + 1] == ';':
                kind = text[pos]
                pos += 2
            out = []
            space()
            while text[pos] != ']':
                out.append(value(depth + 1))
                space()
                if text[pos] == ']':
                    break
                take(',')
            pos += 1
            return Array(kind, out) if kind else out
        if ch in ('"', "'"):
            return quoted()
        raw = token()
        if re.fullmatch(r'[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?[bBsSlLfFdD]?', raw):
            return Number(raw)
        return raw

    out = value()
    space()
    if pos != len(text):
        raise ValueError('Trailing SNBT')
    return out


def dumps(value):
    if isinstance(value, Number):
        return value.raw
    if isinstance(value, bool):
        return '1b' if value else '0b'
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, dict):
        key = lambda k: k if re.fullmatch(r'[A-Za-z0-9_.+-]+', k) else json.dumps(k)
        return '{' + ','.join(key(k) + ':' + dumps(v) for k, v in value.items()) + '}'
    if isinstance(value, list):
        prefix = value.kind + ';' if isinstance(value, Array) else ''
        return '[' + prefix + ','.join(map(dumps, value)) + ']'
    raise TypeError(type(value))
