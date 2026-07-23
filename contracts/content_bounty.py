# v0.2.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
import genlayer.gl.vm as glvm
import json
from dataclasses import dataclass


# Recipient handle used to emit native GEN transfers to any address.
@gl.evm.contract_interface
class _Recipient:
    class View:
        pass

    class Write:
        pass


@allow_storage
@dataclass
class Bounty:
    id: u256
    poster: str
    title: str
    description: str
    criteria: str
    reward: u256
    status: str


@allow_storage
@dataclass
class Submission:
    id: u256
    bounty_id: u256
    creator: str
    content_url: str
    status: str
    score: u256
    feedback: str


class ContentBounty(gl.Contract):
    admin: str
    bounty_count: u256
    submission_count: u256
    bounties: DynArray[Bounty]
    submissions: DynArray[Submission]

    def __init__(self) -> None:
        self.admin = str(gl.message.sender_address)
        self.bounty_count = u256(0)
        self.submission_count = u256(0)

    @gl.public.write.payable
    def post_bounty(self, title: str, description: str, criteria: str) -> u256:
        # The reward is escrowed in the contract via the payable call value,
        # so approvals/cancellations pay out from real, locked funds.
        reward = gl.message.value
        assert len(title) > 0, "Title cannot be empty"
        assert len(criteria) > 0, "Criteria cannot be empty"
        assert int(reward) > 0, "Reward must be greater than 0"

        bounty_id = self.bounty_count
        self.bounty_count += u256(1)

        self.bounties.append(Bounty(
            id=bounty_id,
            poster=str(gl.message.sender_address),
            title=title,
            description=description,
            criteria=criteria,
            reward=reward,
            status="open",
        ))
        return bounty_id

    @gl.public.write
    def submit_content(self, bounty_id: u256, content_url: str) -> u256:
        assert int(bounty_id) < int(self.bounty_count), "Bounty does not exist"
        bounty = self.bounties[int(bounty_id)]
        assert bounty.status == "open", "Bounty is not open"
        assert content_url.startswith("http"), "Invalid URL"

        submission_id = self.submission_count
        self.submission_count += u256(1)

        self.submissions.append(Submission(
            id=submission_id,
            bounty_id=bounty_id,
            creator=str(gl.message.sender_address),
            content_url=content_url,
            status="pending",
            score=u256(0),
            feedback="",
        ))
        return submission_id

    @gl.public.write
    def evaluate_submission(self, submission_id: u256) -> None:
        assert int(submission_id) < int(self.submission_count), "Submission not found"
        submission = self.submissions[int(submission_id)]
        assert submission.status == "pending", "Already evaluated"

        bounty = self.bounties[int(submission.bounty_id)]
        assert bounty.status == "open", "Bounty closed"

        criteria = bounty.criteria
        content_url = submission.content_url

        # Leader closure: fetch the submitted URL and ask the LLM to judge it
        # against the bounty criteria. Runs on the leader; validators re-check
        # the SHAPE of this result via validate_evaluation below (equivalence
        # principle), so honest LLM score variance does not break consensus.
        def get_evaluation() -> dict:
            # A fetch failure is a genuine, explained rejection — never a revert.
            try:
                page = gl.nondet.web.render(content_url, mode="text")
            except Exception:
                return {"approved": False, "score": 0,
                        "feedback": "Could not load the submitted URL."}

            if page is None or len(page.strip()) == 0:
                return {"approved": False, "score": 0,
                        "feedback": "The submitted URL returned no readable content."}

            preview = page[:3000] if len(page) > 3000 else page

            prompt = f"""You are a content evaluator for a Web3 bounty platform.

ACCEPTANCE CRITERIA:
{criteria}

SUBMITTED CONTENT:
{preview}

Does this content meet ALL the acceptance criteria above?

Respond with ONLY this JSON:
{{"approved": true, "score": 85, "feedback": "One sentence reason."}}

approved must be true or false. score is 0-100."""

            result = gl.nondet.exec_prompt(prompt, response_format="json")

            if isinstance(result, str):
                start = result.find("{")
                end = result.rfind("}")
                if start != -1 and end != -1:
                    result = json.loads(result[start:end + 1])

            if not isinstance(result, dict):
                return {"approved": False, "score": 0,
                        "feedback": "The evaluator returned an unreadable response."}

            approved = result.get("approved", False)
            if isinstance(approved, str):
                approved = approved.lower() in ("true", "yes")

            score = result.get("score", 0)
            try:
                score = max(0, min(100, int(float(str(score)))))
            except Exception:
                score = 0

            feedback = str(result.get("feedback", "Evaluated."))
            return {"approved": bool(approved), "score": score, "feedback": feedback}

        # Validator closure: accept any well-formed evaluation. Shape-only so the
        # LLM's non-deterministic wording/score doesn't cause consensus failure.
        def validate_evaluation(leader_result) -> bool:
            if not isinstance(leader_result, glvm.Return):
                return False
            d = leader_result.calldata
            if not isinstance(d, dict):
                return False
            if not isinstance(d.get("approved"), bool):
                return False
            score = d.get("score", -1)
            if not isinstance(score, int) or not (0 <= score <= 100):
                return False
            return isinstance(d.get("feedback"), str)

        # Real non-deterministic AI evaluation under GenLayer consensus.
        eval_result = glvm.run_nondet_unsafe(get_evaluation, validate_evaluation)

        idx = int(submission_id)
        approved = bool(eval_result["approved"])
        self.submissions[idx].status = "approved" if approved else "rejected"
        self.submissions[idx].score = u256(int(eval_result["score"]))
        self.submissions[idx].feedback = str(eval_result["feedback"])

        if approved:
            bidx = int(submission.bounty_id)
            self.bounties[bidx].status = "filled"
            _Recipient(Address(submission.creator)).emit_transfer(value=bounty.reward)

    @gl.public.write
    def approve_with_reward(self, submission_id: u256, custom_reward: u256, feedback: str) -> None:
        assert int(submission_id) < int(self.submission_count), "Submission not found"
        submission = self.submissions[int(submission_id)]
        assert submission.status == "pending", "Already evaluated"
        bounty = self.bounties[int(submission.bounty_id)]
        assert bounty.poster == str(gl.message.sender_address), "Only poster can approve"
        assert bounty.status == "open", "Bounty closed"
        assert int(custom_reward) > 0, "Reward must be greater than 0"
        assert int(custom_reward) <= int(bounty.reward), "Reward exceeds escrowed amount"

        idx = int(submission_id)
        self.submissions[idx].status = "approved"
        self.submissions[idx].score = u256(100)
        self.submissions[idx].feedback = feedback if feedback else "Approved by bounty poster"

        bidx = int(submission.bounty_id)
        self.bounties[bidx].status = "filled"

        # Pay the creator the chosen amount; refund any remainder to the poster.
        _Recipient(Address(submission.creator)).emit_transfer(value=custom_reward)
        remainder = u256(int(bounty.reward) - int(custom_reward))
        if int(remainder) > 0:
            _Recipient(Address(bounty.poster)).emit_transfer(value=remainder)

    @gl.public.write
    def reject_submission(self, submission_id: u256, feedback: str) -> None:
        assert int(submission_id) < int(self.submission_count), "Submission not found"
        submission = self.submissions[int(submission_id)]
        assert submission.status == "pending", "Already evaluated"
        bounty = self.bounties[int(submission.bounty_id)]
        assert bounty.poster == str(gl.message.sender_address), "Only poster can reject"

        idx = int(submission_id)
        self.submissions[idx].status = "rejected"
        self.submissions[idx].score = u256(0)
        self.submissions[idx].feedback = feedback if feedback else "Rejected by bounty poster"

    @gl.public.write
    def cancel_bounty(self, bounty_id: u256) -> None:
        assert int(bounty_id) < int(self.bounty_count), "Not found"
        bounty = self.bounties[int(bounty_id)]
        assert bounty.poster == str(gl.message.sender_address), "Not the poster"
        assert bounty.status == "open", "Cannot cancel"

        reward = bounty.reward
        self.bounties[int(bounty_id)].status = "cancelled"
        # Refund the escrowed reward to the poster.
        _Recipient(Address(bounty.poster)).emit_transfer(value=reward)

    @gl.public.view
    def get_bounty(self, bounty_id: u256) -> dict:
        assert int(bounty_id) < int(self.bounty_count), "Not found"
        b = self.bounties[int(bounty_id)]
        return {
            "id": int(b.id),
            "poster": b.poster,
            "title": b.title,
            "description": b.description,
            "criteria": b.criteria,
            "reward": int(b.reward),
            "status": b.status,
        }

    @gl.public.view
    def get_all_bounties(self) -> list:

        result = []
        for i in range(int(self.bounty_count)):
            b = self.bounties[i]
            result.append({
                "id": int(b.id),
                "title": b.title,
                "description": b.description,
                "reward": int(b.reward),
                "status": b.status,
                "poster": b.poster,
            })
        return result

    @gl.public.view
    def get_submissions_for_bounty(self, bounty_id: u256) -> list:
        result = []
        for i in range(int(self.submission_count)):
            s = self.submissions[i]
            if int(s.bounty_id) == int(bounty_id):
                result.append({
                    "id": int(s.id),
                    "bounty_id": int(s.bounty_id),
                    "creator": s.creator,
                    "content_url": s.content_url,
                    "status": s.status,
                    "score": int(s.score),
                    "feedback": s.feedback,
                })
        return result

    @gl.public.view
    def get_submission(self, submission_id: u256) -> dict:
        assert int(submission_id) < int(self.submission_count), "Not found"
        s = self.submissions[int(submission_id)]
        return {
            "id": int(s.id),
            "bounty_id": int(s.bounty_id),
            "creator": s.creator,
            "content_url": s.content_url,
            "status": s.status,
            "score": int(s.score),
            "feedback": s.feedback,
        }
