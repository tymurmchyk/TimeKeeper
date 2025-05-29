export function success(result = {}) {
	result.type = "success";
	return result;
}

export function failure(result = {}) {
	result.type = "failure";
	return result;
}

export function kek(result = {}) {
	result.type = "kek";
	return result;
}