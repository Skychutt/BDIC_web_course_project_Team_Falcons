"""Shared SMTP delivery for transactional email."""
import smtplib
import ssl
from email.errors import HeaderParseError
from email.headerregistry import Address
from email.message import EmailMessage

from flask import current_app

from .core import Problem, require


def deliver(address, subject, message):
    config = current_app.config
    host, sender = config["SMTP_HOST"], config["SMTP_FROM"]
    require(host and sender, "EMAIL_UNAVAILABLE", "Email delivery is not configured", 503)
    try:
        mail = EmailMessage()
        mail["To"] = Address(addr_spec=address)
        mail["From"] = Address(addr_spec=sender)
        mail["Subject"] = subject
        mail.set_content(message)
        mode = config["SMTP_SECURITY"].lower()
        require(mode in ("ssl", "starttls") or
                (mode == "plain" and host in ("localhost", "127.0.0.1", "::1")),
                "EMAIL_UNAVAILABLE", "Invalid email transport settings", 503)
        port = int(config["SMTP_PORT"])
        if mode == "ssl":
            server = smtplib.SMTP_SSL(host, port, timeout=8, context=ssl.create_default_context())
        else:
            server = smtplib.SMTP(host, port, timeout=8)
        with server:
            if mode == "starttls":
                server.starttls(context=ssl.create_default_context())
            if config["SMTP_USERNAME"]:
                server.login(config["SMTP_USERNAME"], config["SMTP_PASSWORD"])
            server.send_message(mail, from_addr=sender, to_addrs=[address])
    except (OSError, ValueError, HeaderParseError, smtplib.SMTPException) as exc:
        raise Problem("EMAIL_UNAVAILABLE", "Could not deliver the verification email", 503) from exc
