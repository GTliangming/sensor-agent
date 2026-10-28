from app.domain.status import TaskStatus as S
from app.domain.status import can_transition


def test_forward_transitions():
    assert can_transition(S.PENDING, S.SUBMITTED)
    assert can_transition(S.SUBMITTED, S.RUNNING)
    assert can_transition(S.RUNNING, S.SUCCEEDED)
    assert can_transition(S.PENDING, S.FAILED)


def test_terminal_states_cannot_be_overwritten():
    for terminal in (S.SUCCEEDED, S.FAILED, S.CANCELLED):
        for dst in S:
            assert not can_transition(terminal, dst)


def test_failed_to_pending_only_via_retry():
    assert not can_transition(S.FAILED, S.PENDING)
    assert can_transition(S.FAILED, S.PENDING, is_retry=True)
    assert not can_transition(S.CANCELLED, S.PENDING, is_retry=True)
