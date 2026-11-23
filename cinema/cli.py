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
    from .community import initialize_community
    initialize_community(engine)
    from .rating_snapshots import initialize_rating_snapshots
    initialize_rating_snapshots(engine)
    from .cancellations import initialize_cancellations
    initialize_cancellations(engine)
    from .counter import initialize_counter
    initialize_counter(engine)
    from .registration import initialize_registration
    initialize_registration(engine)


def register_cli(app):
    @app.cli.command("migrate-registration-email")
    def migrate_registration_email():
        """Add registration verification tables to an existing database."""
        from .registration import initialize_registration
        initialize_registration(db())
        click.echo("Registration email verification schema ready.")

    @app.cli.command("migrate-counter-email")
    def migrate_counter_email():
        """Add the counter email verification table to an existing database."""
        from .counter import initialize_counter
        initialize_counter(db())
        click.echo("Counter email sales schema ready.")

    @app.cli.command("migrate-customer-refunds")
    def migrate_customer_refunds():
        """Enable customer refunds without resetting orders, payments or seats."""
        from .cancellations import initialize_cancellations
        initialize_cancellations(db())
        click.echo("Customer refund schema ready. Existing application data preserved.")

    @app.cli.command("import-rating-snapshots")
    @click.argument("manifest", type=click.Path(exists=True, dir_okay=False))
    def import_rating_snapshots(manifest):
        """Add verified source snapshots without changing votes, baselines or bookings."""
        import json
        from pathlib import Path
        from .rating_snapshots import initialize_rating_snapshots, import_snapshots
        items = json.loads(Path(manifest).read_text(encoding="utf-8"))["films"]
        initialize_rating_snapshots(db())
        try:
            with db().begin() as c:
                count = import_snapshots(c, items)
        except ValueError as error:
            raise click.ClickException(str(error)) from error
        click.echo(f"Imported {count} verified rating snapshots. Customer votes unchanged.")

    @app.cli.command("migrate-community")
    def migrate_community():
        """Add review/discussion tables without modifying existing application data."""
        from .community import initialize_community
        initialize_community(db())
        click.echo("Community tables ready. Existing films, ratings and bookings preserved.")

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
