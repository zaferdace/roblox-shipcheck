--!nonstrict
return {
	require(script.RemoteNoServerValidation),
	require(script.InsecureLoadstringRequire),
	require(script.ClientReadableSecret),
	require(script.ClientAuthorityLeak),
}
