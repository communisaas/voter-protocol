#[test]
fn allow_test_params_env_not_set_in_prod_tests() {
    // In CI / production builds we should NOT be setting ALLOW_TEST_PARAMS.
    // If it is set, fail fast to avoid accidentally enabling unsafe params.
    if let Some(val) = option_env!("ALLOW_TEST_PARAMS") {
        panic!("ALLOW_TEST_PARAMS is set ({val}); unset for production test runs");
    }
}
