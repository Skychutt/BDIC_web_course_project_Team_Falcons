from importlib.resources import files
import click
from flask import current_app
from .core import *


def initialize(engine):
    with engine.connect() as c:
        existing = rows(c, "SHOW TABLES")
        require(
            not existing,
            "SCHEMA_NOT_EMPTY",
            "Refusing to initialize a nonempty database",
            409,
        )
    script = files("cinema").joinpath("sql/001_initial.sql").read_text(encoding="utf-8")
    # The versioned DDL contains only simple statements; remove full-line comments first.
    script = "\n".join(
        line for line in script.splitlines() if not line.lstrip().startswith("--")
    )
    with engine.begin() as c:
        for statement in script.split(";"):
            if statement.strip():
                c.exec_driver_sql(statement)
    from .ratings import initialize_ratings
    initialize_ratings(engine)


def register_cli(app):
    @app.cli.command("init-db")
    def init_db():
        """Apply v1 schema to an explicitly configured EMPTY database only."""
        initialize(db())
        click.echo(
            "Schema initialized with 10-point ratings. MySQL DDL is not transactionally reversible."
        )

    @app.cli.command("seed-demo")
    @click.option(
        "--password",
        envvar="DEMO_PASSWORD",
        required=True,
        hide_input=True,
        help="Local demo password, minimum 10 characters.",
    )
    def seed_demo(password):
        """Populate an empty schema with local demo accounts and future screenings."""
        from .seed import seed

        result = seed(password)
        click.echo(canonical(result))

    @app.cli.command("expire-holds")
    def expire():
        """Run one batch of expired hold cleanup; safe to repeat."""
        from .booking import expire_holds

        click.echo(canonical(expire_holds()))

    @app.cli.command("process-refunds")
    def refunds():
        """Run one batch of cancellation wallet refunds; safe to repeat."""
        from .management import process_pending_refunds

        click.echo(canonical(process_pending_refunds()))
