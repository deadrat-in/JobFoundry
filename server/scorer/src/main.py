import logging
import os
import uvicorn
from src.app import create_app
from src.config import load_config
from src.llm import LiteLLMClient, StubLLM

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("jobfoundry-scorer")


def build_app():
    config = load_config()
    # If explicitly configured to use stub or if no model/key available in test/dev
    if os.getenv("USE_STUB_LLM", "").lower() in ("1", "true", "yes"):
        llm_client = StubLLM()
    else:
        llm_client = LiteLLMClient(
            model=config.scorer_model,
            api_key=config.scorer_api_key,
            api_base=config.scorer_api_base,
        )
    return create_app(llm_client=llm_client, config=config)



app = build_app()


def main():
    config = load_config()
    if os.getenv("USE_STUB_LLM", "").lower() not in ("1", "true", "yes") and (
        not config.scorer_api_base or not config.scorer_api_base.strip()
    ):
        raise RuntimeError(
            "No LLM API base configured. Set OPENROUTER_API_BASE, "
            "SCORER_API_BASE, or OPENAI_API_BASE in the environment."
        )
    uvicorn.run("src.main:app", host=config.host, port=config.port, reload=False)


if __name__ == "__main__":
    main()
